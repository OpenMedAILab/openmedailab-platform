import json
import importlib.util
import io
import threading
import tempfile
import zipfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from django.conf import settings
from django.db import close_old_connections
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from accounts.models import PLATFORM_ADMIN_UID, RoleType
from credits.models import Contribution, ContributionStatus, CreditLedger
from interactions.models import InteractionStatus, ProjectClaimIntent, ProjectFollow, ProjectInterest, ProjectScore, SponsorIntent
from projects.importing import create_project
from projects.models import AuditLog, Project, ProjectDiscussion, ProjectDocument, ProjectProgressEntry, ProjectStage, ProjectTask, Tag, Theme, ThemeFile


class ApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.theme = Theme.objects.create(name="AntiVEGF", slug="antivegf")
        self.tag = Tag.objects.create(name="RAG", slug="rag")
        self.project = Project.objects.create(
            topic_id=1,
            title="纵向病例证据 RAG",
            title_en="Longitudinal evidence RAG",
            summary="用纵向病例证据增强可复核的医学AI判断。",
            problem_statement="随访证据分散，难以复核。",
            clinical_endpoint="复核一致性",
            existing_foundation="已有随访摘要",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        self.project.tags.add(self.tag)

    def post_json(self, path, data):
        return self.client.post(path, data=json.dumps(data), content_type="application/json")

    def patch_json(self, path, data):
        return self.client.patch(path, data=json.dumps(data), content_type="application/json")

    def login_platform_admin(self):
        call_command(
            "ensure_platform_admin",
            username="platform_admin",
            email="admin@example.com",
            password="StrongPass12345",
        )
        admin = User.objects.get(username="platform_admin")
        self.client.force_login(admin)
        return admin

    def test_project_list_and_detail_api(self):
        ProjectDocument.objects.create(
            project=self.project,
            doc_type=ProjectDocument.DocumentType.PDF,
            document_kind=ProjectDocument.DocumentKind.DETAIL,
            title="课题完整方案",
            description="课题 PDF 详情",
            path="media/project-documents/T0001/detail.pdf",
            content_hash="document-public-hash",
        )
        ProjectDocument.objects.create(
            project=self.project,
            doc_type=ProjectDocument.DocumentType.MARKDOWN,
            document_kind=ProjectDocument.DocumentKind.SUPPLEMENT,
            title="补充说明",
            description="补充说明",
            path="media/project-documents/T0001/intro.md",
            content_hash="supplement-public-hash",
        )

        list_response = self.client.get("/api/projects/?q=RAG&page_size=10")
        self.assertEqual(list_response.status_code, 200)
        list_payload = list_response.json()
        self.assertTrue(list_payload["ok"])
        self.assertEqual(list_payload["data"]["pagination"]["total_count"], 1)
        self.assertEqual(list_payload["data"]["results"][0]["topic_id"], 1)
        self.assertEqual(list_payload["data"]["results"][0]["detail_document"]["title"], "课题完整方案")

        detail_response = self.client.get(f"/api/projects/{self.project.pk}/")
        self.assertEqual(detail_response.status_code, 200)
        detail_payload = detail_response.json()
        self.assertEqual(detail_payload["data"]["team_status"]["basic_ready"], False)
        self.assertEqual(detail_payload["data"]["detail_document"]["document_kind"], "detail")
        self.assertEqual(detail_payload["data"]["detail_document"]["path"], "media/project-documents/T0001/detail.pdf")
        self.assertEqual(detail_payload["data"]["documents"][0]["title"], "课题完整方案")
        self.assertEqual(len(detail_payload["data"]["documents"]), 1)
        self.assertNotIn("document-public-hash", json.dumps(detail_payload["data"], ensure_ascii=False))
        self.assertEqual(detail_payload["data"]["problem_statement"], "随访证据分散，难以复核。")
        self.assertEqual(detail_payload["data"]["clinical_endpoint"], "复核一致性")
        self.assertEqual(detail_payload["data"]["existing_foundation"], "已有随访摘要")

    def test_lifecycle_stage_contract_and_public_filters(self):
        stage_values = [value for value, _ in ProjectStage.choices]
        self.assertEqual(
            stage_values,
            ["draft", "open_recruiting", "team_building", "active", "paused", "archived"],
        )

        draft = Project.objects.create(
            topic_id=2,
            title="草稿课题",
            theme=self.theme,
            stage=ProjectStage.DRAFT,
            is_public=True,
        )
        archived = Project.objects.create(
            topic_id=3,
            title="归档课题",
            theme=self.theme,
            stage=ProjectStage.ARCHIVED,
            is_public=True,
        )

        meta_response = self.client.get("/api/meta/")
        self.assertEqual(meta_response.status_code, 200)
        self.assertEqual([item["value"] for item in meta_response.json()["data"]["project_stages"]], stage_values)

        list_response = self.client.get("/api/projects/?page_size=20")
        self.assertEqual(list_response.status_code, 200)
        topic_ids = {item["topic_id"] for item in list_response.json()["data"]["results"]}
        self.assertIn(self.project.topic_id, topic_ids)
        self.assertNotIn(draft.topic_id, topic_ids)
        self.assertNotIn(archived.topic_id, topic_ids)

        self.assertEqual(self.client.get(f"/api/projects/{draft.pk}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/projects/{archived.pk}/").status_code, 404)

        theme_dataset_response = self.client.get(f"/api/themes/{self.theme.slug}/datasets/")
        self.assertEqual(theme_dataset_response.status_code, 200)
        theme_dataset_ids = {item["topic_id"] for item in theme_dataset_response.json()["data"]["projects"]}
        self.assertIn(self.project.topic_id, theme_dataset_ids)
        self.assertNotIn(draft.topic_id, theme_dataset_ids)
        self.assertNotIn(archived.topic_id, theme_dataset_ids)

    def test_meta_includes_platform_stats_without_exposing_user_details(self):
        recent_user = User.objects.create_user(username="recentonline", email="recent@example.com", password="StrongPass12345")
        stale_user = User.objects.create_user(username="staleonline", email="stale@example.com", password="StrongPass12345")
        inactive_user = User.objects.create_user(username="inactiveonline", email="inactive@example.com", password="StrongPass12345", is_active=False)
        now = timezone.now()
        recent_user.profile.last_seen_at = now - timedelta(minutes=2)
        recent_user.profile.save(update_fields=["last_seen_at"])
        stale_user.profile.last_seen_at = now - timedelta(minutes=8)
        stale_user.profile.save(update_fields=["last_seen_at"])
        inactive_user.profile.last_seen_at = now - timedelta(minutes=1)
        inactive_user.profile.save(update_fields=["last_seen_at"])

        response = self.client.get("/api/meta/")

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        stats = data["platform_stats"]
        self.assertEqual(stats["registered_user_count"], 2)
        self.assertEqual(stats["online_user_count"], 1)
        self.assertEqual(stats["online_window_seconds"], 300)
        serialized = json.dumps(data, ensure_ascii=False)
        self.assertNotIn("recent@example.com", serialized)
        self.assertNotIn("last_seen_at", serialized)

    def test_sidebar_qr_codes_are_public_read_admin_uploaded_assets(self):
        user = User.objects.create_user(username="normalqruser", password="StrongPass12345")
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir) / "media", MEDIA_URL="media/"):
            public_response = self.client.get("/api/sidebar-qrs/")
            self.assertEqual(public_response.status_code, 200)
            public_entries = public_response.json()["data"]["entries"]
            self.assertEqual([entry["key"] for entry in public_entries], ["admin-contact", "community"])
            self.assertEqual(public_entries[0]["image"], "")
            self.assertFalse(public_entries[0]["has_image"])

            anonymous_upload_response = self.client.post(
                "/api/admin/sidebar-qrs/admin-contact/image/",
                {"file": SimpleUploadedFile("admin.png", b"\x89PNG\r\n\x1a\nadmin", content_type="image/png")},
            )
            self.assertEqual(anonymous_upload_response.status_code, 401)

            self.client.force_login(user)
            forbidden_response = self.client.post(
                "/api/admin/sidebar-qrs/admin-contact/image/",
                {"file": SimpleUploadedFile("admin.png", b"\x89PNG\r\n\x1a\nadmin", content_type="image/png")},
            )
            self.assertEqual(forbidden_response.status_code, 403)

            admin = self.login_platform_admin()
            upload_response = self.client.post(
                "/api/admin/sidebar-qrs/admin-contact/image/",
                {"file": SimpleUploadedFile("admin.png", b"\x89PNG\r\n\x1a\nadmin", content_type="image/png")},
            )
            self.assertEqual(upload_response.status_code, 201)
            uploaded_entry = upload_response.json()["data"]["entry"]
            self.assertEqual(uploaded_entry["key"], "admin-contact")
            self.assertTrue(uploaded_entry["has_image"])
            self.assertIn("system-qrcodes/admin-contact.png", uploaded_entry["image"])
            self.assertTrue((Path(settings.MEDIA_ROOT) / "system-qrcodes" / "admin-contact.png").is_file())

            replacement_response = self.client.post(
                "/api/admin/sidebar-qrs/admin-contact/image/",
                {"file": SimpleUploadedFile("admin.webp", b"RIFF\x00\x00\x00\x00WEBPadmin", content_type="image/webp")},
            )
            self.assertEqual(replacement_response.status_code, 201)
            replacement_entry = replacement_response.json()["data"]["entry"]
            self.assertIn("system-qrcodes/admin-contact.webp", replacement_entry["image"])
            self.assertFalse((Path(settings.MEDIA_ROOT) / "system-qrcodes" / "admin-contact.png").exists())
            self.assertTrue((Path(settings.MEDIA_ROOT) / "system-qrcodes" / "admin-contact.webp").is_file())

            meta_response = self.client.get("/api/meta/")
            self.assertEqual(meta_response.status_code, 200)
            meta_entry = meta_response.json()["data"]["sidebar_qr_entries"][0]
            self.assertTrue(meta_entry["has_image"])
            self.assertIn("system-qrcodes/admin-contact.webp", meta_entry["image"])
            self.assertTrue(AuditLog.objects.filter(actor=admin, action="platform_qr.upload", target_id="admin-contact").exists())

            bad_type_response = self.client.post(
                "/api/admin/sidebar-qrs/community/image/",
                {"file": SimpleUploadedFile("community.txt", b"not-image", content_type="text/plain")},
            )
            self.assertEqual(bad_type_response.status_code, 422)

            bad_signature_response = self.client.post(
                "/api/admin/sidebar-qrs/community/image/",
                {"file": SimpleUploadedFile("community.png", b"not-a-real-image", content_type="image/png")},
            )
            self.assertEqual(bad_signature_response.status_code, 422)

            unknown_response = self.client.post(
                "/api/admin/sidebar-qrs/unknown/image/",
                {"file": SimpleUploadedFile("admin.png", b"\x89PNG\r\n\x1a\nadmin", content_type="image/png")},
            )
            self.assertEqual(unknown_response.status_code, 404)

    def test_authenticated_request_refreshes_last_seen_but_payloads_do_not_expose_it(self):
        user = User.objects.create_user(username="heartbeatuser", email="heartbeat@example.com", password="StrongPass12345")
        old_seen_at = timezone.now() - timedelta(minutes=10)
        user.profile.last_seen_at = old_seen_at
        user.profile.save(update_fields=["last_seen_at"])

        self.client.force_login(user)
        response = self.client.get("/api/me/")

        self.assertEqual(response.status_code, 200)
        user.profile.refresh_from_db()
        self.assertGreater(user.profile.last_seen_at, old_seen_at)
        self.assertNotIn("last_seen_at", json.dumps(response.json()["data"], ensure_ascii=False))

        marker = timezone.now()
        user.profile.last_seen_at = marker
        user.profile.save(update_fields=["last_seen_at"])
        throttled_response = self.client.get("/api/me/")
        self.assertEqual(throttled_response.status_code, 200)
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.last_seen_at, marker)

        self.login_platform_admin()
        detail_response = self.client.get(f"/api/admin/users/{user.profile.uid}/")
        self.assertEqual(detail_response.status_code, 200)
        self.assertNotIn("last_seen_at", json.dumps(detail_response.json()["data"], ensure_ascii=False))

    def test_anonymous_request_does_not_update_last_seen(self):
        user = User.objects.create_user(username="anonymousheartbeat", email="anonymousheartbeat@example.com", password="StrongPass12345")
        self.assertIsNone(user.profile.last_seen_at)

        response = self.client.get("/api/meta/")

        self.assertEqual(response.status_code, 200)
        user.profile.refresh_from_db()
        self.assertIsNone(user.profile.last_seen_at)

    def test_project_list_includes_persisted_viewer_state_for_authenticated_user(self):
        user = User.objects.create_user(username="viewerstate", email="viewerstate@example.com", password="StrongPass12345")
        ProjectFollow.objects.create(user=user, project=self.project)
        ProjectScore.objects.create(user=user, project=self.project, score=10, comment="点赞")
        ProjectInterest.objects.create(
            user=user,
            project=self.project,
            role="学生",
            available_hours_per_week=4,
            status=InteractionStatus.APPROVED,
        )
        claim = ProjectClaimIntent.objects.create(
            user=user,
            project=self.project,
            claim_type="leader",
            status=InteractionStatus.APPROVED,
        )
        SponsorIntent.objects.create(user=user, project=self.project, sponsor_type="compute", status=InteractionStatus.PENDING)

        self.client.force_login(user)
        response = self.client.get("/api/projects/?page_size=10")

        self.assertEqual(response.status_code, 200)
        project = response.json()["data"]["results"][0]
        viewer = project["viewer_state"]
        self.assertTrue(viewer["is_following"])
        self.assertEqual(viewer["score"]["score"], 10)
        self.assertIn("学生", viewer["interest_roles"])
        self.assertIn("leader", viewer["claim_types"])
        self.assertIn("compute", viewer["sponsor_types"])

        claim.status = InteractionStatus.WITHDRAWN
        claim.save(update_fields=["status", "updated_at"])
        withdrawn_response = self.client.get("/api/projects/?page_size=10")

        self.assertEqual(withdrawn_response.status_code, 200)
        withdrawn_viewer = withdrawn_response.json()["data"]["results"][0]["viewer_state"]
        self.assertNotIn("leader", withdrawn_viewer["claim_types"])

    def test_anonymous_project_payload_uses_uid_only_for_creator(self):
        creator = User.objects.create_user(
            username="privacycreator",
            email="privacycreator@example.com",
            password="StrongPass12345",
        )
        creator.profile.display_name = "真实昵称"
        creator.profile.real_name = "真实姓名"
        creator.profile.contact_wechat = "wechat-secret"
        creator.profile.save(update_fields=["display_name", "real_name", "contact_wechat", "updated_at"])
        self.project.created_by = creator
        self.project.save(update_fields=["created_by", "updated_at"])

        response = self.client.get("/api/projects/?page_size=1")

        self.assertEqual(response.status_code, 200)
        project = response.json()["data"]["results"][0]
        payload = json.dumps(project, ensure_ascii=False)
        self.assertIn(creator.profile.uid, payload)
        self.assertNotIn("真实昵称", payload)
        self.assertNotIn("真实姓名", payload)
        self.assertNotIn("privacycreator", payload)
        self.assertNotIn("wechat-secret", payload)
        creator_payload = project["created_by_display"]
        self.assertEqual(creator_payload["uid"], creator.profile.uid)
        self.assertNotIn("name", creator_payload)
        self.assertNotIn("wechat", creator_payload)

    def test_anonymous_status_card_project_uses_uid_only_for_creator(self):
        creator = User.objects.create_user(
            username="statusprivacycreator",
            email="statusprivacycreator@example.com",
            password="StrongPass12345",
        )
        creator.profile.display_name = "状态卡昵称"
        creator.profile.contact_wechat = "status-wechat-secret"
        creator.profile.save(update_fields=["display_name", "contact_wechat", "updated_at"])
        self.project.created_by = creator
        self.project.save(update_fields=["created_by", "updated_at"])

        response = self.client.get(f"/api/projects/{self.project.pk}/status-card/")

        self.assertEqual(response.status_code, 200)
        project = response.json()["data"]["project"]
        payload = json.dumps(project, ensure_ascii=False)
        self.assertIn(creator.profile.uid, payload)
        self.assertNotIn("状态卡昵称", payload)
        self.assertNotIn("statusprivacycreator", payload)
        self.assertNotIn("status-wechat-secret", payload)
        self.assertEqual(project["created_by_display"]["uid"], creator.profile.uid)
        self.assertNotIn("name", project["created_by_display"])
        self.assertNotIn("wechat", project["created_by_display"])

    def test_project_list_sorts_by_topic_id_by_default_and_newest_number(self):
        popular_user = User.objects.create_user(username="popularsort", email="popularsort@example.com", password="StrongPass12345")
        Project.objects.create(
            topic_id=3,
            title="第三个公开课题",
            summary="默认排序不应被热度影响。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        Project.objects.create(
            topic_id=2,
            title="第二个公开课题",
            summary="默认排序按编号。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        ProjectFollow.objects.create(user=popular_user, project=Project.objects.get(topic_id=3))
        self.project.title = "最近更新但编号最小"
        self.project.save(update_fields=["title", "updated_at"])

        default_response = self.client.get("/api/projects/?page_size=10")
        newest_response = self.client.get("/api/projects/?sort=newest&page_size=10")
        updated_response = self.client.get("/api/projects/?sort=updated&page_size=10")

        self.assertEqual(default_response.status_code, 200)
        self.assertEqual(newest_response.status_code, 200)
        self.assertEqual(updated_response.status_code, 200)
        self.assertEqual([row["topic_id"] for row in default_response.json()["data"]["results"][:3]], [1, 2, 3])
        self.assertEqual([row["topic_id"] for row in newest_response.json()["data"]["results"][:3]], [3, 2, 1])
        self.assertEqual(updated_response.json()["data"]["results"][0]["topic_id"], 1)

    def test_project_list_likes_sort_happens_before_pagination(self):
        low_like = Project.objects.create(
            topic_id=9911,
            title="低赞",
            summary="低赞",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        high_like = Project.objects.create(
            topic_id=9912,
            title="高赞",
            summary="高赞",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        ProjectScore.objects.create(
            user=User.objects.create_user(username="lowlikeuser", email="lowlikeuser@example.com", password="StrongPass12345"),
            project=low_like,
            score=10,
        )
        for idx in range(3):
            user = User.objects.create_user(username=f"liker{idx}", email=f"liker{idx}@example.com", password="StrongPass12345")
            ProjectScore.objects.create(user=user, project=high_like, score=10)

        response = self.client.get("/api/projects/?sort=likes&page_size=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["results"][0]["id"], high_like.id)

    def test_recruiting_and_follow_stage_rules(self):
        user = User.objects.create_user(username="stageuser", email="stageuser@example.com", password="StrongPass12345")
        self.client.force_login(user)

        self.project.stage = ProjectStage.ACTIVE
        self.project.save(update_fields=["stage", "updated_at"])
        active_interest_response = self.post_json(
            f"/api/projects/{self.project.pk}/interest/",
            {"role": "学生", "available_hours_per_week": 2},
        )
        self.assertEqual(active_interest_response.status_code, 422)
        self.assertEqual(active_interest_response.json()["error"]["code"], "project_not_recruiting")

        follow_response = self.post_json(f"/api/projects/{self.project.pk}/follow/", {})
        self.assertEqual(follow_response.status_code, 200)
        self.project.stage = ProjectStage.PAUSED
        self.project.save(update_fields=["stage", "updated_at"])
        paused_follow_response = self.post_json(f"/api/projects/{self.project.pk}/follow/", {})
        self.assertEqual(paused_follow_response.status_code, 404)
        unfollow_response = self.post_json(f"/api/projects/{self.project.pk}/unfollow/", {})
        self.assertEqual(unfollow_response.status_code, 200)
        self.assertFalse(ProjectFollow.objects.filter(user=user, project=self.project).exists())

        self.project.stage = ProjectStage.TEAM_BUILDING
        self.project.save(update_fields=["stage", "updated_at"])
        for path, payload in [
            (f"/api/projects/{self.project.pk}/interest/", {"role": "学生", "available_hours_per_week": 2}),
            (f"/api/projects/{self.project.pk}/claim/", {"claim_type": "leader"}),
            (f"/api/projects/{self.project.pk}/sponsor/", {"sponsor_type": "compute"}),
        ]:
            response = self.post_json(path, payload)
            self.assertEqual(response.status_code, 201)

    def test_team_status_counts_only_approved_relationships(self):
        doctor = User.objects.create_user(username="teamdoctor", email="teamdoctor@example.com", password="StrongPass12345")
        student = User.objects.create_user(username="teamstudent", email="teamstudent@example.com", password="StrongPass12345")
        sponsor = User.objects.create_user(username="teamsponsor", email="teamsponsor@example.com", password="StrongPass12345")
        ProjectInterest.objects.create(user=doctor, project=self.project, role="医生", status=InteractionStatus.PENDING)
        ProjectInterest.objects.create(user=student, project=self.project, role="学生", status=InteractionStatus.APPROVED)
        SponsorIntent.objects.create(user=sponsor, project=self.project, sponsor_type="compute", status=InteractionStatus.REJECTED)

        status = Project.objects.get(pk=self.project.pk).team_status
        self.assertEqual(status["roles"]["医生"], 0)
        self.assertEqual(status["roles"]["学生"], 1)
        self.assertEqual(status["sponsor_count"], 0)

    def test_project_sponsor_count_only_counts_approved_intents(self):
        pending = User.objects.create_user(username="pendingfund", email="pendingfund@example.com", password="StrongPass12345")
        approved = User.objects.create_user(username="approvedfund", email="approvedfund@example.com", password="StrongPass12345")
        rejected = User.objects.create_user(username="rejectedfund", email="rejectedfund@example.com", password="StrongPass12345")
        SponsorIntent.objects.create(user=pending, project=self.project, sponsor_type="compute", status=InteractionStatus.PENDING)
        SponsorIntent.objects.create(user=approved, project=self.project, sponsor_type="labor_fee", status=InteractionStatus.APPROVED)
        SponsorIntent.objects.create(user=rejected, project=self.project, sponsor_type="token", status=InteractionStatus.REJECTED)

        response = self.client.get("/api/projects/?page_size=1")

        self.assertEqual(response.status_code, 200)
        project = response.json()["data"]["results"][0]
        self.assertEqual(project["sponsor_count"], 1)
        self.assertEqual(project["team_status"]["sponsor_count"], 1)

    def test_team_status_counts_other_interest_as_visible_student_fallback(self):
        user = User.objects.create_user(username="otherparticipant", email="otherparticipant@example.com", password="StrongPass12345")
        user.profile.role_type = RoleType.OTHER
        user.profile.save(update_fields=["role_type", "updated_at"])
        ProjectInterest.objects.create(user=user, project=self.project, role="其他", status=InteractionStatus.APPROVED)

        status = Project.objects.get(pk=self.project.pk).team_status
        roles = {item["key"]: item for item in status["required_roles"]}
        self.assertEqual(status["roles"]["其他"], 1)
        self.assertEqual(roles["student"]["count"], 1)
        self.assertTrue(roles["student"]["ready"])

    def test_score_does_not_change_project_stage_or_lifecycle_status_card_groups(self):
        user = User.objects.create_user(username="scoreuser", email="scoreuser@example.com", password="StrongPass12345")
        self.client.force_login(user)

        response = self.post_json(f"/api/projects/{self.project.pk}/score/", {"score": 9, "comment": "关注"})
        self.assertEqual(response.status_code, 200)
        self.project.refresh_from_db()
        self.assertEqual(self.project.stage, ProjectStage.OPEN_RECRUITING)

        card_response = self.client.get(f"/api/projects/{self.project.pk}/status-card/")
        self.assertEqual(card_response.status_code, 200)
        card = card_response.json()["data"]
        self.assertNotIn("已评分", " ".join(card["viewer_state"]["activity_labels"]))
        group_types = {group["type"] for group in card["uid_groups"]["groups"]}
        self.assertNotIn("score", group_types)

    def test_auth_required_for_dashboard(self):
        response = self.client.get("/api/me/dashboard/")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "auth_required")

    def test_openapi_docs_are_generated_from_api_schema(self):
        schema_response = self.client.get("/api/openapi.json")
        self.assertEqual(schema_response.status_code, 200)
        schema = schema_response.json()
        self.assertIn("/api/projects/", schema["paths"])
        self.assertIn("RegisterRequest", schema["components"]["schemas"])
        self.assertNotIn("/api/auth/email-verification/request/", schema["paths"])
        self.assertNotIn("/api/auth/email-verification/confirm/", schema["paths"])
        self.assertNotIn("/api/auth/password-reset/request/", schema["paths"])
        self.assertNotIn("/api/auth/password-reset/confirm/", schema["paths"])
        self.assertIn("/api/auth/password/change-required/", schema["paths"])
        self.assertIn("/api/admin/users/", schema["paths"])
        self.assertIn("/api/admin/users/{uid}/reset-password/", schema["paths"])
        self.assertIn("/api/admin/projects/import-json/", schema["paths"])
        self.assertIn("/api/admin/theme-files/", schema["paths"])
        self.assertIn("/api/admin/theme-files/{file_id}/detail-pdf/", schema["paths"])
        self.assertIn("/api/themes/{slug}/datasets/", schema["paths"])
        self.assertNotIn("/api/themes/{slug}/space/", schema["paths"])
        self.assertNotIn("/api/admin/file-space/", schema["paths"])
        self.assertNotIn("/api/admin/file-space/root/", schema["paths"])
        self.assertNotIn("/api/admin/file-space/file/", schema["paths"])
        self.assertNotIn("/api/admin/file-space/upload/", schema["paths"])
        self.assertNotIn("/api/admin/themes/{theme_id}/file-space-root/", schema["paths"])
        self.assertIn("/api/admin/projects/{project_id}/", schema["paths"])
        self.assertIn("/api/projects/{project_id}/status-card/", schema["paths"])
        self.assertIn("/api/admin/overview/", schema["paths"])
        self.assertIn("/api/admin/interactions/", schema["paths"])
        self.assertIn("/api/admin/tasks/", schema["paths"])
        self.assertIn("/api/admin/contributions/{contribution_id}/review/", schema["paths"])
        self.assertIn("/api/admin/audit-logs/", schema["paths"])
        self.assertIn("/api/me/contributions/", schema["paths"])
        self.assertIn("/api/me/contributions/upload/", schema["paths"])

        docs_response = self.client.get("/api/docs")
        self.assertEqual(docs_response.status_code, 200)
        self.assertContains(docs_response, "OpenMedAILab API")

        contract_response = self.client.get("/api/project-schema/")
        self.assertEqual(contract_response.status_code, 200)
        contract_data = contract_response.json()["data"]
        contract_fields = [field["name"] for field in contract_data["fields"]]
        self.assertIn("id", contract_fields)
        self.assertIn("title_en", contract_fields)
        self.assertIn("problem_statement", contract_fields)
        self.assertIn("clinical_endpoint", contract_fields)
        self.assertIn("existing_foundation", contract_fields)
        self.assertIn("summary", contract_fields)
        self.assertNotIn("data_requirements", contract_fields)
        self.assertNotIn("project_no", contract_fields)
        self.assertNotIn("documents", contract_fields)
        self.assertNotIn("source_md_path", contract_fields)
        self.assertNotIn("source_pdf_path", contract_fields)
        self.assertIn("json_template", contract_data)
        self.assertIn("document_kinds", contract_data)
        self.assertEqual([item["value"] for item in contract_data["document_types"]], ["pdf"])
        self.assertEqual([item["value"] for item in contract_data["document_kinds"]], ["detail", "progress"])
        self.assertNotIn("jsonl_template", contract_data)
        self.assertNotIn('"id":1', contract_data["json_template"])
        self.assertIn("250字以内", contract_data["json_template"])
        self.assertNotIn("markdown_template", contract_data)
        self.assertNotIn("example", contract_data)
        theme_file_types = [item["value"] for item in contract_data["theme_file_types"]]
        self.assertEqual(theme_file_types, ["dataset_meta"])
        self.assertNotIn("dataset", theme_file_types)
        self.assertNotIn("data_dictionary", theme_file_types)
        self.assertNotIn("markdown", theme_file_types)
        self.assertNotIn("pdf", theme_file_types)

    def test_release_version_and_changelog_are_exposed_consistently(self):
        version = (settings.BASE_DIR / "VERSION").read_text(encoding="utf-8").strip()
        changelog = (settings.BASE_DIR / "CHANGELOG.md").read_text(encoding="utf-8")

        self.assertRegex(version, r"^\d+\.\d+\.\d+$")
        self.assertIn(f"## {version} - ", changelog)

        schema_response = self.client.get("/api/openapi.json")
        self.assertEqual(schema_response.status_code, 200)
        self.assertEqual(schema_response.json()["info"]["version"], version)

        meta_response = self.client.get("/api/meta/")
        self.assertEqual(meta_response.status_code, 200)
        release = meta_response.json()["data"]["release"]
        self.assertEqual(release["version"], version)
        self.assertEqual(release["latest"]["version"], version)
        self.assertIn("date", release["latest"])
        self.assertTrue(release["latest"]["sections"])
        self.assertIsInstance(release["history"], list)

    def test_release_payload_reads_current_version_file(self):
        from config import release as release_module

        version = (settings.BASE_DIR / "VERSION").read_text(encoding="utf-8").strip()
        with patch.object(release_module, "APP_VERSION", "0.0.0"):
            payload = release_module.release_payload()

        self.assertEqual(payload["version"], version)
        self.assertEqual(payload["latest"]["version"], version)

    def test_theme_dataset_pdf_api(self):
        ThemeFile.objects.create(
            theme=self.theme,
            section="数据集说明文件",
            file_type=ThemeFile.FileType.DATASET_META,
            title="抗 VEGF 脱敏随访数据说明",
            path="dataset-descriptions/antivegf-followup",
            detail_pdf_title="数据集特点说明",
            detail_pdf_path="media/theme-file-detail-pdfs/antivegf/1/detail.pdf",
        )

        response = self.client.get(f"/api/themes/{self.theme.slug}/datasets/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["theme"]["slug"], "antivegf")
        self.assertNotIn("file_space", payload["theme"])
        self.assertEqual(payload["project_count"], 1)
        self.assertEqual(payload["file_count"], 1)
        self.assertEqual(payload["sections"][0]["name"], "数据集说明文件")
        self.assertEqual(payload["sections"][0]["files"][0]["title"], "抗 VEGF 脱敏随访数据说明")
        self.assertEqual(payload["sections"][0]["files"][0]["detail_pdf_title"], "数据集特点说明")
        self.assertEqual(payload["sections"][0]["files"][0]["detail_pdf_path"], "media/theme-file-detail-pdfs/antivegf/1/detail.pdf")
        self.assertNotIn("documents_by_type", payload)

    def test_admin_can_upload_dataset_detail_pdf(self):
        self.login_platform_admin()
        dataset = ThemeFile.objects.create(
            theme=self.theme,
            section="数据集说明文件",
            file_type=ThemeFile.FileType.DATASET_META,
            title="抗 VEGF 脱敏随访数据说明",
            path="dataset-descriptions/antivegf-followup",
        )
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir), MEDIA_URL="/media/"):
            response = self.client.post(
                f"/api/admin/theme-files/{dataset.pk}/detail-pdf/",
                {
                    "title": "数据集特点说明",
                    "file": SimpleUploadedFile("dataset-detail.pdf", b"%PDF-1.4\n% Dataset\n%%EOF\n", content_type="application/pdf"),
                },
            )

            self.assertEqual(response.status_code, 201)
            payload = response.json()["data"]
            self.assertEqual(payload["detail_pdf_title"], "数据集特点说明")
            self.assertTrue(payload["detail_pdf_path"].endswith(f"/media/theme-file-detail-pdfs/antivegf/{dataset.pk}/dataset-detail.pdf"))
            self.assertTrue((Path(tmpdir) / "theme-file-detail-pdfs" / "antivegf" / str(dataset.pk) / "dataset-detail.pdf").exists())

            public_response = self.client.get(f"/api/themes/{self.theme.slug}/datasets/")
            self.assertEqual(public_response.status_code, 200)
            public_file = public_response.json()["data"]["sections"][0]["files"][0]
            self.assertEqual(public_file["detail_pdf_title"], "数据集特点说明")
            self.assertEqual(public_file["detail_pdf_path"], payload["detail_pdf_path"])

    def test_theme_detail_pdf_rejects_fake_pdf_and_writes_failed_audit(self):
        admin = self.login_platform_admin()
        dataset = ThemeFile.objects.create(
            theme=self.theme,
            section="数据集说明文件",
            file_type=ThemeFile.FileType.DATASET_META,
            title="抗 VEGF 脱敏随访数据说明",
            path="dataset-descriptions/antivegf-followup",
        )
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir), MEDIA_URL="/media/"):
            response = self.client.post(
                f"/api/admin/theme-files/{dataset.pk}/detail-pdf/",
                {
                    "title": "假 PDF",
                    "file": SimpleUploadedFile("fake.pdf", b"not a pdf", content_type="application/pdf"),
                },
            )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["message"], "PDF 文件格式无法识别。")
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="theme_file.detail_pdf_upload",
                target_type="ThemeFile",
                target_id=str(dataset.pk),
                status="failed",
                error_code="validation_error",
            ).exists()
        )

    def test_admin_theme_dataset_description_uses_generated_path(self):
        self.login_platform_admin()
        response = self.post_json(
            "/api/admin/theme-files/",
            {
                "theme_id": self.theme.pk,
                "title": "抗 VEGF 数据集说明",
                "description": "只保存说明 PDF，不保存原始数据集。",
            },
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["section"], "数据集说明文件")
        self.assertEqual(payload["file_type"], ThemeFile.FileType.DATASET_META)
        self.assertTrue(payload["path"].startswith("dataset-descriptions/"))

    def test_protected_post_uses_csrf_envelope_when_enforced(self):
        user = User.objects.create_user(username="csrfuser", password="StrongPass12345")
        secure_client = Client(enforce_csrf_checks=True)
        secure_client.force_login(user)

        response = secure_client.post(
            f"/api/projects/{self.project.pk}/follow/",
            data=json.dumps({}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "csrf_failed")

    def test_admin_can_manage_theme_and_create_project(self):
        call_command(
            "ensure_platform_admin",
            username="platform_admin",
            email="admin@example.com",
            password="StrongPass12345",
        )
        admin = User.objects.get(username="platform_admin")
        self.client.force_login(admin)

        theme_response = self.post_json(
            "/api/admin/themes/",
            {
                "name": "视网膜影像",
                "slug": "retina-imaging",
                "description": "眼科影像相关课题",
            },
        )
        self.assertEqual(theme_response.status_code, 201)
        self.assertEqual(theme_response.json()["data"]["slug"], "retina-imaging")
        self.assertNotIn("file_space", theme_response.json()["data"])

        create_response = self.post_json(
            "/api/admin/projects/",
            {
                "id": 4,
                "theme": "视网膜影像",
                "title": "OCT 病灶分割评估",
                "title_en": "OCT lesion segmentation evaluation",
                "summary": "评估OCT病灶分割结果能否形成稳定、可复核的临床辅助证据。",
                "problem_statement": "验证分割结果能否复核。",
                "clinical_endpoint": "医生复核一致性",
                "existing_foundation": "已有OCT标注",
                "tags": ["OCT", "分割"],
            },
        )
        self.assertEqual(create_response.status_code, 201)
        project = Project.objects.get(topic_id=4)
        self.assertEqual(project.problem_statement, "验证分割结果能否复核。")
        self.assertEqual(project.title_en, "OCT lesion segmentation evaluation")
        self.assertEqual(project.stage, ProjectStage.DRAFT)
        self.assertFalse(project.is_public)

        file_response = self.post_json(
            "/api/admin/theme-files/",
            {
                "theme_id": project.theme_id,
                "section": "数据说明",
                "file_type": "dataset_meta",
                "title": "脱敏数据说明",
                "description": "主题级数据集说明记录",
            },
        )
        self.assertEqual(file_response.status_code, 201)
        file_id = file_response.json()["data"]["id"]

        file_list_response = self.client.get(f"/api/admin/theme-files/?theme_id={project.theme_id}&page_size=50")
        self.assertEqual(file_list_response.status_code, 200)
        self.assertEqual(file_list_response.json()["data"]["pagination"]["total_count"], 1)

        file_update_response = self.patch_json(f"/api/admin/theme-files/{file_id}/", {"title": "数据字典说明"})
        self.assertEqual(file_update_response.status_code, 200)
        self.assertEqual(file_update_response.json()["data"]["title"], "数据字典说明")

        project_detail_response = self.client.get(f"/api/admin/projects/{project.pk}/")
        self.assertEqual(project_detail_response.status_code, 200)
        self.assertEqual(project_detail_response.json()["data"]["topic_id"], 4)

        project_update_response = self.patch_json(f"/api/admin/projects/{project.pk}/", {"title": "OCT 病灶分割临床评估", "stage": "active"})
        self.assertEqual(project_update_response.status_code, 200)
        project.refresh_from_db()
        self.assertEqual(project.title, "OCT 病灶分割临床评估")
        self.assertEqual(project.stage, ProjectStage.ACTIVE)

        file_delete_response = self.client.delete(f"/api/admin/theme-files/{file_id}/")
        self.assertEqual(file_delete_response.status_code, 200)
        self.assertFalse(ThemeFile.objects.get(pk=file_id).is_active)

    def test_admin_theme_deactivate_and_delete_are_separate(self):
        self.login_platform_admin()
        theme = Theme.objects.create(name="待删除主题", slug="delete-theme")
        project = Project.objects.create(
            topic_id=15,
            title="保留课题",
            problem_statement="课题不随主题删除",
            clinical_endpoint="验证课题保留",
            existing_foundation="已有测试数据",
            theme=theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        theme_file = ThemeFile.objects.create(
            theme=theme,
            file_type=ThemeFile.FileType.DATASET_META,
            title="待删除主题说明",
            path="dataset-descriptions/delete-theme",
            detail_pdf_title="说明 PDF",
            detail_pdf_path="/media/theme-file-detail-pdfs/delete-theme/1/detail.pdf",
        )

        deactivate_response = self.patch_json(f"/api/admin/themes/{theme.pk}/", {"is_active": False})
        self.assertEqual(deactivate_response.status_code, 200)
        theme.refresh_from_db()
        self.assertFalse(theme.is_active)
        self.assertTrue(Project.objects.filter(pk=project.pk, theme=theme).exists())
        self.assertTrue(ThemeFile.objects.filter(pk=theme_file.pk).exists())

        delete_response = self.client.delete(f"/api/admin/themes/{theme.pk}/")
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(delete_response.json()["data"], {"id": theme.pk, "deleted": True})
        self.assertFalse(Theme.objects.filter(pk=theme.pk).exists())
        self.assertFalse(ThemeFile.objects.filter(pk=theme_file.pk).exists())
        project.refresh_from_db()
        self.assertIsNone(project.theme_id)
        self.assertTrue(AuditLog.objects.filter(action="theme.delete", target_id=str(theme.pk)).exists())

    def test_admin_project_create_update_boundaries(self):
        admin = self.login_platform_admin()

        response = self.post_json(
            "/api/admin/projects/",
            {
                "theme": self.theme.slug,
                "title": "新建课题",
                "summary": "新建课题摘要",
                "problem_statement": "科学问题",
                "clinical_endpoint": "临床终点",
                "existing_foundation": "已有基础",
                "stage": "active",
                "is_public": True,
            },
        )
        self.assertEqual(response.status_code, 201)
        created = Project.objects.get(title="新建课题")
        self.assertEqual(created.topic_id, 2)
        self.assertEqual(created.stage, ProjectStage.DRAFT)
        self.assertFalse(created.is_public)
        self.assertEqual(response.json()["data"]["stage"], ProjectStage.DRAFT)
        self.assertFalse(response.json()["data"]["is_public"])
        self.assertFalse(Project.objects.filter(pk=created.pk, is_public=True).exists())

        duplicate_response = self.post_json(
            "/api/admin/projects/",
            {
                "id": created.topic_id,
                "theme": self.theme.slug,
                "title": "重复课题",
                "summary": "重复课题摘要",
                "problem_statement": "科学问题",
                "clinical_endpoint": "临床终点",
                "existing_foundation": "已有基础",
            },
        )
        self.assertEqual(duplicate_response.status_code, 422)
        self.assertEqual(Project.objects.filter(topic_id=created.topic_id).count(), 1)
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="project.create",
                target_id="new",
                status="failed",
                error_code="validation_error",
                error_message="id already exists.",
            ).exists()
        )

        legacy_id_response = self.post_json(
            "/api/admin/projects/",
            {
                "topic_id": "ROP-1",
                "theme": self.theme.slug,
                "title": "旧编号课题",
                "summary": "旧编号课题摘要",
                "problem_statement": "科学问题",
                "clinical_endpoint": "临床终点",
                "existing_foundation": "已有基础",
            },
        )
        self.assertEqual(legacy_id_response.status_code, 422)
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="project.create",
                target_id="new",
                status="failed",
                error_code="validation_error",
            ).exists()
        )

        topic_change_response = self.patch_json(
            f"/api/admin/projects/{created.pk}/",
            {"id": created.topic_id + 1, "title": "不允许改编号"},
        )
        self.assertEqual(topic_change_response.status_code, 422)
        self.assertFalse(Project.objects.filter(topic_id=created.topic_id + 1).exists())
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="project.update",
                target_id=str(created.pk),
                status="failed",
                error_code="validation_error",
                error_message="topic_id cannot be changed.",
            ).exists()
        )

        unknown_theme_response = self.post_json(
            "/api/admin/projects/",
            {
                "theme": "不存在主题",
                "title": "未知主题课题",
                "summary": "未知主题课题摘要",
                "problem_statement": "科学问题",
                "clinical_endpoint": "临床终点",
                "existing_foundation": "已有基础",
            },
        )
        self.assertEqual(unknown_theme_response.status_code, 422)
        self.assertFalse(Theme.objects.filter(name="不存在主题").exists())
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="project.create",
                target_id="new",
                status="failed",
                error_code="validation_error",
            ).exists()
        )

    def test_auto_topic_id_retries_after_collision(self):
        with patch("projects.importing.next_topic_id", side_effect=[self.project.topic_id, self.project.topic_id + 1]):
            created = create_project(
                {
                    "theme": self.theme.slug,
                    "title": "自动编号重试课题",
                    "summary": "自动编号遇到唯一约束冲突时应重试。",
                },
                allow_create_theme=False,
            )

        self.assertEqual(created.topic_id, self.project.topic_id + 1)
        self.assertEqual(Project.objects.filter(topic_id=self.project.topic_id + 1).count(), 1)

    def test_regular_user_can_manage_only_owned_projects_with_daily_quota(self):
        owner = User.objects.create_user(username="project_owner", email="project-owner@example.com", password="StrongPass12345")
        other = User.objects.create_user(username="project_other", email="project-other@example.com", password="StrongPass12345")
        self.client.force_login(owner)

        create_response = self.post_json(
            "/api/projects/",
            {
                "theme": self.theme.slug,
                "title": "用户上传课题",
                "summary": "普通用户可以上传自己的课题。",
                "problem_statement": "用户上传流程需要可追溯。",
                "clinical_endpoint": "上传权限正确",
                "existing_foundation": "已有基础",
                "tags": ["用户上传"],
            },
        )

        self.assertEqual(create_response.status_code, 201)
        created = Project.objects.get(title="用户上传课题")
        self.assertEqual(created.created_by, owner)
        self.assertEqual(created.stage, ProjectStage.DRAFT)
        self.assertFalse(created.is_public)
        self.assertEqual(create_response.json()["data"]["created_by"]["uid"], owner.profile.uid)
        self.assertTrue(
            AuditLog.objects.filter(
                actor=owner,
                action="project.user_create",
                target_type="Project",
                target_id=str(created.pk),
                status="success",
            )
            .exclude(request_id="")
            .exists()
        )

        list_response = self.client.get("/api/me/projects/?page_size=10")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual([item["id"] for item in list_response.json()["data"]["results"]], [created.id])

        self.client.force_login(other)
        other_list_response = self.client.get("/api/me/projects/?page_size=10")
        self.assertEqual(other_list_response.status_code, 200)
        self.assertEqual(other_list_response.json()["data"]["results"], [])
        self.assertEqual(other_list_response.json()["data"]["pagination"]["total_count"], 0)

        self.client.force_login(owner)
        publish_response = self.patch_json(f"/api/projects/{created.pk}/", {"stage": "open_recruiting"})
        self.assertEqual(publish_response.status_code, 200)
        created.refresh_from_db()
        self.assertEqual(created.stage, ProjectStage.OPEN_RECRUITING)
        self.assertTrue(created.is_public)

        forbidden_stage_response = self.patch_json(f"/api/projects/{created.pk}/", {"stage": "active"})
        self.assertEqual(forbidden_stage_response.status_code, 422)
        self.assertEqual(forbidden_stage_response.json()["error"]["code"], "user_project_stage_forbidden")

        created.stage = ProjectStage.ACTIVE
        created.is_public = True
        created.save(update_fields=["stage", "is_public", "updated_at"])
        locked_stage_response = self.patch_json(f"/api/projects/{created.pk}/", {"stage": "open_recruiting", "title": "不允许回退"})
        self.assertEqual(locked_stage_response.status_code, 422)
        self.assertEqual(locked_stage_response.json()["error"]["code"], "user_project_stage_locked")
        created.refresh_from_db()
        self.assertEqual(created.stage, ProjectStage.ACTIVE)
        self.assertNotEqual(created.title, "不允许回退")
        content_update_response = self.patch_json(f"/api/projects/{created.pk}/", {"title": "允许维护内容", "summary": "后续阶段仍允许维护自己上传的课题内容。"})
        self.assertEqual(content_update_response.status_code, 200)
        created.refresh_from_db()
        self.assertEqual(created.stage, ProjectStage.ACTIVE)
        self.assertEqual(created.title, "允许维护内容")
        self.assertTrue(
            AuditLog.objects.filter(
                actor=owner,
                action="project.user_update",
                target_id=str(created.pk),
                status="failed",
                error_code="user_project_stage_locked",
            ).exists()
        )

        self.client.force_login(other)
        other_update_response = self.patch_json(f"/api/projects/{created.pk}/", {"title": "不允许修改"})
        self.assertEqual(other_update_response.status_code, 403)
        other_delete_response = self.client.delete(f"/api/projects/{created.pk}/")
        self.assertEqual(other_delete_response.status_code, 403)

        for index in range(9):
            Project.objects.create(
                topic_id=20 + index,
                title=f"今日已上传 {index}",
                summary="配额测试",
                theme=self.theme,
                stage=ProjectStage.DRAFT,
                is_public=False,
                created_by=owner,
            )

        self.client.force_login(owner)
        quota_response = self.post_json(
            "/api/projects/",
            {
                "theme": self.theme.slug,
                "title": "第十一个课题",
                "summary": "普通用户每日最多上传十个。",
            },
        )
        self.assertEqual(quota_response.status_code, 422)
        self.assertEqual(quota_response.json()["error"]["code"], "daily_project_upload_limit_exceeded")

        admin = self.login_platform_admin()
        admin_response = self.post_json(
            "/api/projects/",
            {
                "theme": self.theme.slug,
                "title": "管理员不受配额限制",
                "summary": "管理员可通过同一接口上传课题。",
            },
        )
        self.assertEqual(admin_response.status_code, 201)
        self.assertEqual(Project.objects.get(title="管理员不受配额限制").created_by, admin)

    def test_regular_user_can_upload_replace_and_delete_owned_project_pdf(self):
        owner = User.objects.create_user(username="pdf_owner", email="pdf-owner@example.com", password="StrongPass12345")
        other = User.objects.create_user(username="pdf_other", email="pdf-other@example.com", password="StrongPass12345")
        project = Project.objects.create(
            topic_id=8,
            title="用户 PDF 课题",
            summary="普通用户需要上传课题说明 PDF。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
            created_by=owner,
        )
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir), MEDIA_URL="media/"):
            self.client.force_login(owner)
            upload_response = self.client.post(
                "/api/project-documents/upload/",
                {
                    "project_id": project.pk,
                    "document_kind": "detail",
                    "doc_type": "pdf",
                    "title": "用户课题 PDF",
                    "files": SimpleUploadedFile("detail.pdf", b"%PDF-1.4\n% User detail\n%%EOF\n", content_type="application/pdf"),
                },
            )
            self.assertEqual(upload_response.status_code, 201)
            self.assertEqual(ProjectDocument.objects.filter(project=project, document_kind=ProjectDocument.DocumentKind.DETAIL).count(), 1)
            public_payload = self.client.get(f"/api/projects/{project.pk}/").json()["data"]
            self.assertEqual(public_payload["created_by"]["uid"], owner.profile.uid)
            self.assertEqual(public_payload["detail_document"]["title"], "用户课题 PDF")

            self.client.force_login(other)
            forbidden_response = self.client.post(
                "/api/project-documents/upload/",
                {
                    "project_id": project.pk,
                    "files": SimpleUploadedFile("other.pdf", b"%PDF-1.4\n% Other\n%%EOF\n", content_type="application/pdf"),
                },
            )
            self.assertEqual(forbidden_response.status_code, 403)

            self.client.force_login(owner)
            replacement_response = self.client.post(
                "/api/project-documents/upload/",
                {
                    "project_id": project.pk,
                    "title": "替换后的用户课题 PDF",
                    "files": SimpleUploadedFile("detail-v2.pdf", b"%PDF-1.4\n% User detail v2\n%%EOF\n", content_type="application/pdf"),
                },
            )
            self.assertEqual(replacement_response.status_code, 201)
            self.assertEqual(ProjectDocument.objects.filter(project=project, document_kind=ProjectDocument.DocumentKind.DETAIL).count(), 1)
            document = ProjectDocument.objects.get(project=project)
            self.assertEqual(document.title, "替换后的用户课题 PDF")

            delete_response = self.client.delete(f"/api/project-documents/{document.pk}/")
            self.assertEqual(delete_response.status_code, 200)
            self.assertFalse(ProjectDocument.objects.filter(project=project).exists())

            project.stage = ProjectStage.ARCHIVED
            project.save(update_fields=["stage", "updated_at"])
            locked_response = self.client.post(
                "/api/project-documents/upload/",
                {
                    "project_id": project.pk,
                    "files": SimpleUploadedFile("locked.pdf", b"%PDF-1.4\n% Locked\n%%EOF\n", content_type="application/pdf"),
                },
            )
            self.assertEqual(locked_response.status_code, 422)
            self.assertEqual(locked_response.json()["error"]["code"], "user_project_stage_locked")

    def test_user_project_detail_pdf_rejects_fake_pdf_and_writes_failed_audit(self):
        owner = User.objects.create_user(username="fake_pdf_owner", email="fake-pdf-owner@example.com", password="StrongPass12345")
        project = Project.objects.create(
            topic_id=18,
            title="用户假 PDF 课题",
            summary="普通用户上传假 PDF 应被拒绝。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
            created_by=owner,
        )
        self.client.force_login(owner)
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir), MEDIA_URL="media/"):
            response = self.client.post(
                "/api/project-documents/upload/",
                {
                    "project_id": project.pk,
                    "document_kind": "detail",
                    "title": "假 PDF",
                    "files": SimpleUploadedFile("fake.pdf", b"not a pdf", content_type="application/pdf"),
                },
            )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["message"], "PDF 文件格式无法识别。")
        self.assertTrue(
            AuditLog.objects.filter(
                actor=owner,
                action="project_document.user_upload",
                target_type="Project",
                target_id=str(project.pk),
                status="failed",
                error_code="validation_error",
            ).exists()
        )

    def test_request_id_is_bounded_in_errors_and_audit_logs(self):
        owner = User.objects.create_user(username="request_owner", email="request-owner@example.com", password="StrongPass12345")
        self.client.force_login(owner)
        request_id = "request-id-" + ("x" * 200)

        response = self.client.post(
            "/api/projects/",
            data=json.dumps({"theme": "不存在主题", "title": "失败课题", "summary": "失败摘要"}),
            content_type="application/json",
            HTTP_X_REQUEST_ID=request_id,
        )

        self.assertEqual(response.status_code, 422)
        self.assertLessEqual(len(response["X-Request-ID"]), 64)
        payload = response.json()
        self.assertEqual(payload["request_id"], response["X-Request-ID"])
        self.assertLessEqual(len(payload["error"]["request_id"]), 64)
        audit_entry = AuditLog.objects.get(actor=owner, action="project.user_create", status="failed")
        self.assertEqual(audit_entry.request_id, response["X-Request-ID"])
        self.assertLessEqual(len(audit_entry.request_id), 64)

    def test_admin_project_list_supports_id_duplicate_detection(self):
        self.login_platform_admin()

        topic_response = self.client.get("/api/admin/projects/?topic_id=1&page_size=10")
        self.assertEqual(topic_response.status_code, 200)
        topic_rows = topic_response.json()["data"]["results"]
        self.assertEqual(len(topic_rows), 1)
        self.assertEqual(topic_rows[0]["topic_id"], 1)

    def test_admin_project_list_orders_by_topic_id_ascending(self):
        self.login_platform_admin()
        Project.objects.create(
            topic_id=3,
            title="第三个课题",
            summary="用于测试排序。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        Project.objects.create(
            topic_id=2,
            title="第二个课题",
            summary="用于测试排序。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        later = Project.objects.get(topic_id=1)
        later.title = "最近更新但编号最小"
        later.save(update_fields=["title", "updated_at"])

        response = self.client.get("/api/admin/projects/?page_size=10")

        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]["results"]
        self.assertEqual([row["topic_id"] for row in rows[:3]], [1, 2, 3])

    def test_admin_project_bulk_archive_hides_selected_projects(self):
        self.login_platform_admin()
        second = Project.objects.create(
            topic_id=2,
            title="批量删除课题二",
            summary="用于测试批量归档。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        third = Project.objects.create(
            topic_id=3,
            title="批量删除课题三",
            summary="用于测试批量归档。",
            theme=self.theme,
            stage=ProjectStage.ACTIVE,
            is_public=True,
        )

        response = self.post_json("/api/admin/projects/bulk-archive/", {"ids": [second.pk, third.pk, third.pk, 999999]})

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["archived_count"], 2)
        self.assertEqual(payload["missing_ids"], [999999])
        second.refresh_from_db()
        third.refresh_from_db()
        self.project.refresh_from_db()
        self.assertEqual(second.stage, ProjectStage.ARCHIVED)
        self.assertFalse(second.is_public)
        self.assertEqual(third.stage, ProjectStage.ARCHIVED)
        self.assertFalse(third.is_public)
        self.assertEqual(self.project.stage, ProjectStage.OPEN_RECRUITING)
        self.assertTrue(self.project.is_public)
        public_response = self.client.get("/api/projects/?page_size=10")
        public_topic_ids = {item["topic_id"] for item in public_response.json()["data"]["results"]}
        self.assertIn(self.project.topic_id, public_topic_ids)
        self.assertNotIn(second.topic_id, public_topic_ids)
        self.assertNotIn(third.topic_id, public_topic_ids)
        self.assertTrue(AuditLog.objects.filter(action="project.bulk_archive", target_id="bulk").exists())

    def test_admin_project_bulk_action_updates_and_deletes_selected_projects(self):
        self.login_platform_admin()
        second = Project.objects.create(
            topic_id=2,
            title="批量操作课题二",
            summary="用于测试批量操作。",
            theme=self.theme,
            stage=ProjectStage.DRAFT,
            is_public=False,
        )
        third = Project.objects.create(
            topic_id=3,
            title="批量操作课题三",
            summary="用于测试批量删除。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        ProjectDocument.objects.create(
            project=third,
            doc_type=ProjectDocument.DocumentType.PDF,
            document_kind=ProjectDocument.DocumentKind.DETAIL,
            title="批量删除 PDF",
            path="media/project-documents/T0003/detail.pdf",
        )

        public_response = self.post_json(
            "/api/admin/projects/bulk-action/",
            {"ids": [second.pk], "action": "set_public", "is_public": True},
        )
        self.assertEqual(public_response.status_code, 200)
        second.refresh_from_db()
        self.assertTrue(second.is_public)

        stage_response = self.post_json(
            "/api/admin/projects/bulk-action/",
            {"ids": [second.pk], "action": "set_stage", "stage": "team_building"},
        )
        self.assertEqual(stage_response.status_code, 200)
        second.refresh_from_db()
        self.assertEqual(second.stage, ProjectStage.TEAM_BUILDING)

        delete_response = self.post_json(
            "/api/admin/projects/bulk-action/",
            {"ids": [third.pk, 999999], "action": "delete"},
        )
        self.assertEqual(delete_response.status_code, 200)
        delete_payload = delete_response.json()["data"]
        self.assertEqual(delete_payload["affected_count"], 1)
        self.assertEqual(delete_payload["missing_ids"], [999999])
        self.assertFalse(Project.objects.filter(pk=third.pk).exists())
        self.assertFalse(ProjectDocument.objects.filter(project_id=third.pk).exists())
        self.assertTrue(AuditLog.objects.filter(action="project.bulk_set_public", target_id="bulk").exists())
        self.assertTrue(AuditLog.objects.filter(action="project.bulk_set_stage", target_id="bulk").exists())
        self.assertTrue(AuditLog.objects.filter(action="project.bulk_delete", target_id="bulk").exists())

    def test_admin_project_delete_physically_removes_project(self):
        self.login_platform_admin()
        project = Project.objects.create(
            topic_id=9,
            title="待物理删除课题",
            summary="用于测试管理员物理删除。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        ProjectDocument.objects.create(
            project=project,
            doc_type=ProjectDocument.DocumentType.PDF,
            document_kind=ProjectDocument.DocumentKind.DETAIL,
            title="待删除 PDF",
            path="media/project-documents/T0009/detail.pdf",
        )

        response = self.client.delete(f"/api/admin/projects/{project.pk}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"], {"id": project.pk, "deleted": True})
        self.assertFalse(Project.objects.filter(pk=project.pk).exists())
        self.assertFalse(ProjectDocument.objects.filter(project_id=project.pk).exists())
        self.assertTrue(AuditLog.objects.filter(action="project.delete", target_id=str(project.pk)).exists())

    def test_admin_project_json_import_auto_assigns_incrementing_topic_ids(self):
        self.login_platform_admin()

        response = self.post_json(
            "/api/admin/projects/import-json/",
            {
                "projects": [
                    {
                        "theme": "FFA",
                        "title": "FFA 图文证据链病例复核基准",
                        "summary": "围绕 FFA 图文证据链构建可复核开放课题。",
                        "problem_statement": "证据链难以追踪。",
                        "clinical_endpoint": "证据忠实度",
                        "existing_foundation": "已有 FFA 多源数据。",
                    },
                    {
                        "theme": "FFA",
                        "title": "FFA 时相质量控制",
                        "summary": "围绕 FFA 时相质量控制形成开放研究课题。",
                        "problem_statement": "时相质量不稳定。",
                        "clinical_endpoint": "时相识别一致性",
                        "existing_foundation": "已有 FFA 图像和报告。",
                    },
                ]
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["created_count"], 2)
        self.assertEqual([item["project"]["topic_code"] for item in payload["results"]], ["T0002", "T0003"])
        self.assertEqual(Project.objects.get(title="FFA 图文证据链病例复核基准").topic_id, 2)
        self.assertEqual(Project.objects.get(title="FFA 时相质量控制").topic_id, 3)
        self.assertTrue(Theme.objects.filter(name="FFA").exists())

        explicit_response = self.post_json(
            "/api/admin/projects/import-json/",
            {
                "projects": [
                    {
                        "id": "T0010",
                        "theme": "FFA",
                        "title": "显式编号课题",
                        "summary": "显式编号导入。",
                    },
                    {
                        "theme": "FFA",
                        "title": "自动编号跟随最大值",
                        "summary": "显式编号后继续自动递增。",
                    },
                ]
            },
        )

        self.assertEqual(explicit_response.status_code, 200)
        explicit_payload = explicit_response.json()["data"]
        self.assertEqual([item["project"]["topic_code"] for item in explicit_payload["results"]], ["T0010", "T0011"])

        title_response = self.client.get("/api/admin/projects/?q=纵向病例&page_size=10")
        self.assertEqual(title_response.json()["data"]["pagination"]["total_count"], 1)

    def test_admin_project_json_import_auto_number_ignores_source_ids(self):
        self.login_platform_admin()
        Project.objects.create(
            topic_id=2,
            title="已有第二个课题",
            summary="已有课题。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )

        response = self.post_json(
            "/api/admin/projects/import-json/",
            {
                "auto_number": True,
                "projects": [
                    {
                        "id": "T0001",
                        "theme": "FFA",
                        "title": "自动编号导入课题一",
                        "summary": "虽然 JSON 写了 T0001，但导入时应从现有最大编号继续。",
                    },
                    {
                        "id": "T0002",
                        "theme": "FFA",
                        "title": "自动编号导入课题二",
                        "summary": "虽然 JSON 写了 T0002，但导入时应从现有最大编号继续。",
                    },
                ],
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["created_count"], 2)
        self.assertEqual(payload["updated_count"], 0)
        self.assertEqual([item["project"]["topic_code"] for item in payload["results"]], ["T0003", "T0004"])
        self.assertEqual(Project.objects.get(topic_id=1).title, "纵向病例证据 RAG")
        self.assertEqual(Project.objects.get(topic_id=2).title, "已有第二个课题")

    def test_admin_project_json_import_returns_validation_error_for_database_failures(self):
        self.login_platform_admin()

        with patch("api.ninja_api.upsert_project_with_instance", side_effect=ValueError("数据库保存失败")):
            response = self.post_json(
                "/api/admin/projects/import-json/",
                {
                    "projects": [
                        {
                            "theme": "FFA",
                            "title": "触发保存异常",
                            "summary": "数据库保存异常应返回 422。",
                            "problem_statement": "导入失败应可读。",
                            "clinical_endpoint": "错误反馈",
                            "existing_foundation": "已有测试主题",
                        }
                    ]
                },
            )

        self.assertEqual(response.status_code, 422)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertEqual(payload["error"]["details"][0]["row"], 1)
        self.assertTrue(AuditLog.objects.filter(action="project.import_json", status="failed").exists())

    def test_admin_user_list_orders_platform_admin_first_then_uid(self):
        admin = self.login_platform_admin()
        high_uid_user = User.objects.create_user(username="highuid", email="highuid@example.com", password="StrongPass12345")
        low_uid_user = User.objects.create_user(username="lowuid", email="lowuid@example.com", password="StrongPass12345")
        blank_uid_user = User.objects.create_user(username="blankuid", email="blankuid@example.com", password="StrongPass12345")
        high_uid_user.profile.uid = "S00000050"
        high_uid_user.profile.save(update_fields=["uid"])
        low_uid_user.profile.uid = "D00000002"
        low_uid_user.profile.save(update_fields=["uid"])
        blank_uid_user.profile.uid = ""
        blank_uid_user.profile.save(update_fields=["uid"])

        response = self.client.get("/api/admin/users/?page_size=10")

        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]["results"]
        self.assertEqual(rows[0]["username"], admin.username)
        self.assertEqual(rows[0]["profile"]["uid"], PLATFORM_ADMIN_UID)
        self.assertEqual([row["username"] for row in rows[:4]], ["platform_admin", "lowuid", "highuid", "blankuid"])

        search_response = self.client.get("/api/admin/users/?q=example.com&page_size=10")
        self.assertEqual(search_response.status_code, 200)
        search_rows = search_response.json()["data"]["results"]
        self.assertEqual(search_rows[0]["username"], admin.username)
        self.assertEqual(search_rows[0]["profile"]["uid"], PLATFORM_ADMIN_UID)

    def test_public_project_detail_hides_internal_source_fields(self):
        self.project.source_payload = {"source": "api-admin", "payload": {"secret": "internal"}}
        self.project.save(update_fields=["source_payload", "updated_at"])
        ProjectDocument.objects.create(
            project=self.project,
            doc_type=ProjectDocument.DocumentType.MARKDOWN,
            title="内部 Markdown",
            path="/Users/wang/private/topics/AntiVEGF-001.md",
            content_hash="document-internal-hash",
        )
        ProjectDocument.objects.create(
            project=self.project,
            doc_type=ProjectDocument.DocumentType.MARKDOWN,
            title="穿越路径",
            path="/media/../private/secret.md",
            content_hash="document-traversal-hash",
        )

        response = self.client.get(f"/api/projects/{self.project.pk}/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertNotIn("source_payload", payload)
        self.assertNotIn("imported_at", payload)
        self.assertEqual(payload["documents"], [])
        self.assertNotIn("/Users/wang/private", json.dumps(payload, ensure_ascii=False))
        self.assertNotIn("document-internal-hash", json.dumps(payload, ensure_ascii=False))
        self.assertNotIn("document-traversal-hash", json.dumps(payload, ensure_ascii=False))

    def test_admin_project_document_upload_accepts_only_one_public_detail_pdf(self):
        self.login_platform_admin()
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir), MEDIA_URL="media/"):
            unsupported_markdown = self.client.post(
                "/api/admin/project-documents/upload/",
                {
                    "project_id": self.project.pk,
                    "doc_type": "markdown",
                    "title": "课题介绍",
                    "description": "课题介绍",
                    "files": SimpleUploadedFile("intro.md", b"# Intro", content_type="text/markdown"),
                },
            )
            self.assertEqual(unsupported_markdown.status_code, 422)

            detail_response = self.client.post(
                "/api/admin/project-documents/upload/",
                {
                    "project_id": self.project.pk,
                    "document_kind": "detail",
                    "doc_type": "pdf",
                    "title": "课题主文档",
                    "files": SimpleUploadedFile("detail.pdf", b"%PDF-1.4\n% Detail\n%%EOF\n", content_type="application/pdf"),
                },
            )
            self.assertEqual(detail_response.status_code, 201)
            detail_payload = detail_response.json()["data"]
            self.assertEqual(detail_payload["saved"][0]["document_kind"], "detail")
            self.assertEqual(detail_payload["saved"][0]["doc_type"], "pdf")
            self.assertEqual(detail_payload["saved"][0]["description"], "课题 PDF 详情")
            public_detail = self.client.get(f"/api/projects/{self.project.pk}/").json()["data"]
            self.assertEqual(public_detail["detail_document"]["title"], "课题主文档")
            self.assertEqual(public_detail["documents"][0]["title"], "课题主文档")

            replacement_response = self.client.post(
                "/api/admin/project-documents/upload/",
                {
                    "project_id": self.project.pk,
                    "document_kind": "detail",
                    "doc_type": "pdf",
                    "title": "替换后的主文档",
                    "files": SimpleUploadedFile("detail-v2.pdf", b"%PDF-1.4\n% Detail v2\n%%EOF\n", content_type="application/pdf"),
                },
            )
            self.assertEqual(replacement_response.status_code, 201)
            self.assertEqual(ProjectDocument.objects.filter(project=self.project, document_kind=ProjectDocument.DocumentKind.DETAIL).count(), 1)
            self.assertEqual(
                self.client.get(f"/api/projects/{self.project.pk}/").json()["data"]["detail_document"]["title"],
                "替换后的主文档",
            )

    def test_admin_project_detail_pdf_rejects_fake_pdf_and_writes_failed_audit(self):
        admin = self.login_platform_admin()
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir), MEDIA_URL="media/"):
            response = self.client.post(
                "/api/admin/project-documents/upload/",
                {
                    "project_id": self.project.pk,
                    "document_kind": "detail",
                    "title": "假主文档",
                    "files": SimpleUploadedFile("fake.pdf", b"not a pdf", content_type="application/pdf"),
                },
            )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["message"], "PDF 文件格式无法识别。")
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="project_document.upload",
                target_type="Project",
                target_id=str(self.project.pk),
                status="failed",
                error_code="validation_error",
            ).exists()
        )

    def test_team_status_marks_required_roles_as_missing_ready_or_overfilled(self):
        doctor = User.objects.create_user(username="doctor1", password="StrongPass12345")
        doctor.profile.role_type = RoleType.DOCTOR
        doctor.profile.save(update_fields=["role_type", "updated_at"])
        doctor2 = User.objects.create_user(username="doctor2", password="StrongPass12345")
        doctor2.profile.role_type = RoleType.DOCTOR
        doctor2.profile.save(update_fields=["role_type", "updated_at"])
        student = User.objects.create_user(username="student1", password="StrongPass12345")
        student.profile.role_type = RoleType.UNDERGRAD_OR_BELOW
        student.profile.save(update_fields=["role_type", "updated_at"])
        ProjectInterest.objects.create(project=self.project, user=doctor, role="医生", status=InteractionStatus.APPROVED)
        ProjectInterest.objects.create(project=self.project, user=doctor2, role="医生", status=InteractionStatus.APPROVED)
        ProjectInterest.objects.create(project=self.project, user=student, role="学生", status=InteractionStatus.APPROVED)

        roles = {item["key"]: item for item in self.project.team_status["required_roles"]}

        self.assertEqual(roles["doctor"]["required"], 1)
        self.assertTrue(roles["doctor"]["ready"])
        self.assertTrue(roles["doctor"]["overfilled"])
        self.assertEqual(roles["doctor"]["status"], "overfilled")
        self.assertTrue(roles["student"]["ready"])
        self.assertFalse(roles["student"]["overfilled"])
        self.assertEqual(roles["student"]["status"], "ready")
        self.assertFalse(roles["leader"]["ready"])
        self.assertFalse(roles["leader"]["overfilled"])
        self.assertEqual(roles["leader"]["status"], "missing")

    def test_admin_can_reorder_themes_with_audit(self):
        second = Theme.objects.create(name="ROP", slug="rop", sort_order=20, is_active=False)
        third = Theme.objects.create(name="AMD", slug="amd", sort_order=30)
        admin = self.login_platform_admin()

        response = self.patch_json("/api/admin/themes/reorder/", {"theme_ids": [third.id, self.theme.id, second.id]})

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]["themes"]
        self.assertEqual([item["id"] for item in payload], [third.id, self.theme.id, second.id])
        self.assertEqual([item["sort_order"] for item in payload], [10, 20, 30])
        self.theme.refresh_from_db()
        second.refresh_from_db()
        third.refresh_from_db()
        self.assertEqual((third.sort_order, self.theme.sort_order, second.sort_order), (10, 20, 30))
        audit_entry = AuditLog.objects.get(actor=admin, action="theme.reorder")
        self.assertEqual(audit_entry.after["order"], {str(third.id): 10, str(self.theme.id): 20, str(second.id): 30})

        missing_response = self.patch_json("/api/admin/themes/reorder/", {"theme_ids": [third.id, 99999]})
        self.assertEqual(missing_response.status_code, 422)
        self.assertEqual(missing_response.json()["error"]["code"], "validation_error")

    def test_project_progress_api_and_progress_document_upload_keep_history(self):
        owner = User.objects.create_user(username="progress_owner", password="StrongPass12345")
        self.project.created_by = owner
        self.project.project_progress = "已经完成首批数据清洗。"
        self.project.save(update_fields=["created_by", "project_progress", "updated_at"])
        admin = self.login_platform_admin()
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir), MEDIA_URL="media/"):
            detail_response = self.client.post(
                "/api/admin/project-documents/upload/",
                {
                    "project_id": self.project.pk,
                    "document_kind": "detail",
                    "title": "主方案",
                    "files": SimpleUploadedFile("detail.pdf", b"%PDF-1.4\n% Detail\n%%EOF\n", content_type="application/pdf"),
                },
            )
            self.assertEqual(detail_response.status_code, 201)
            first_progress = self.client.post(
                "/api/admin/project-documents/upload/",
                {
                    "project_id": self.project.pk,
                    "document_kind": "progress",
                    "title": "第 1 周进度",
                    "description": "完成数据清洗",
                    "files": SimpleUploadedFile("week-1.pdf", b"%PDF-1.4\n% Week1\n%%EOF\n", content_type="application/pdf"),
                },
            )
            second_progress = self.client.post(
                "/api/admin/project-documents/upload/",
                {
                    "project_id": self.project.pk,
                    "document_kind": "progress",
                    "title": "第 2 周进度",
                    "description": "完成初步建模",
                    "files": SimpleUploadedFile("week-2.pdf", b"%PDF-1.4\n% Week2\n%%EOF\n", content_type="application/pdf"),
                },
            )

            self.assertEqual(first_progress.status_code, 201)
            self.assertEqual(second_progress.status_code, 201)
            self.assertEqual(ProjectDocument.objects.filter(project=self.project, document_kind=ProjectDocument.DocumentKind.DETAIL).count(), 1)
            self.assertEqual(ProjectDocument.objects.filter(project=self.project, document_kind=ProjectDocument.DocumentKind.PROGRESS).count(), 2)
            self.assertEqual(ProjectProgressEntry.objects.filter(project=self.project, entry_type=ProjectProgressEntry.EntryType.DOCUMENT).count(), 2)
            self.assertTrue(AuditLog.objects.filter(actor=admin, action="project_progress.document_create").exists())

            progress_response = self.client.get(f"/api/projects/{self.project.pk}/progress/")
            self.assertEqual(progress_response.status_code, 200)
            payload = progress_response.json()["data"]
            self.assertEqual(payload["project"]["id"], self.project.id)
            self.assertEqual(payload["progress_text"], "已经完成首批数据清洗。")
            self.assertEqual([item["document_kind"] for item in payload["documents"]], ["progress", "progress"])
            self.assertEqual(payload["timeline"][0]["entry_type"], "document")
            self.assertNotIn("progress_owner", json.dumps(payload, ensure_ascii=False))

            self.project.stage = ProjectStage.ARCHIVED
            self.project.save(update_fields=["stage", "updated_at"])
            archived_response = self.client.get(f"/api/projects/{self.project.pk}/progress/")
            self.assertEqual(archived_response.status_code, 404)

    def test_admin_project_progress_pdf_rejects_fake_pdf_and_writes_failed_audit(self):
        admin = self.login_platform_admin()
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir), MEDIA_URL="media/"):
            response = self.client.post(
                "/api/admin/project-documents/upload/",
                {
                    "project_id": self.project.pk,
                    "document_kind": "progress",
                    "title": "假进度文档",
                    "files": SimpleUploadedFile("fake.pdf", b"not a pdf", content_type="application/pdf"),
                },
            )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["message"], "PDF 文件格式无法识别。")
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="project_document.upload",
                target_type="Project",
                target_id=str(self.project.pk),
                status="failed",
                error_code="validation_error",
            ).exists()
        )

    def test_project_discussion_lifecycle_permissions_and_privacy(self):
        author = User.objects.create_user(username="discussion_author", password="StrongPass12345")
        other = User.objects.create_user(username="discussion_other", password="StrongPass12345")
        admin = self.login_platform_admin()

        public_list = self.client.get(f"/api/projects/{self.project.pk}/discussions/")
        self.assertEqual(public_list.status_code, 200)
        self.assertEqual(public_list.json()["data"]["results"], [])

        self.client.logout()
        anonymous_write = self.post_json(f"/api/projects/{self.project.pk}/discussions/", {"content": "匿名不应写入"})
        self.assertEqual(anonymous_write.status_code, 401)

        self.client.force_login(author)
        create_response = self.post_json(f"/api/projects/{self.project.pk}/discussions/", {"content": "建议先明确纳排标准。"})
        self.assertEqual(create_response.status_code, 201)
        discussion_id = create_response.json()["data"]["id"]
        reply_response = self.post_json(
            f"/api/projects/{self.project.pk}/discussions/",
            {"content": "可以放在第一版进度文档里。", "parent_id": discussion_id},
        )
        self.assertEqual(reply_response.status_code, 201)
        nested_reply_response = self.post_json(
            f"/api/projects/{self.project.pk}/discussions/",
            {"content": "不允许回复回复。", "parent_id": reply_response.json()["data"]["id"]},
        )
        self.assertEqual(nested_reply_response.status_code, 422)

        list_response = self.client.get(f"/api/projects/{self.project.pk}/discussions/")
        payload = list_response.json()["data"]["results"][0]
        self.assertEqual(payload["author"]["uid"], author.profile.uid)
        self.assertEqual(payload["reply_count"], 1)
        self.assertNotIn("discussion_author", json.dumps(payload, ensure_ascii=False))
        self.assertNotIn("email", json.dumps(payload, ensure_ascii=False))

        update_response = self.patch_json(f"/api/project-discussions/{discussion_id}/", {"content": "更新后的讨论。"})
        self.assertEqual(update_response.status_code, 200)

        self.client.force_login(other)
        forbidden_response = self.patch_json(f"/api/project-discussions/{discussion_id}/", {"content": "不能改别人"})
        self.assertEqual(forbidden_response.status_code, 403)

        self.client.force_login(admin)
        moderation_response = self.patch_json(
            f"/api/admin/project-discussions/{discussion_id}/moderation/",
            {"status": "hidden", "moderation_reason": "不适合公开"},
        )
        self.assertEqual(moderation_response.status_code, 200)
        hidden_list = self.client.get(f"/api/projects/{self.project.pk}/discussions/")
        self.assertEqual(hidden_list.json()["data"]["results"], [])
        self.assertTrue(AuditLog.objects.filter(action="project_discussion.create").exists())
        self.assertTrue(AuditLog.objects.filter(action="project_discussion.update").exists())
        self.assertTrue(AuditLog.objects.filter(action="project_discussion.moderate").exists())

    def test_content_backup_includes_progress_documents_and_entries_without_user_fk(self):
        admin = self.login_platform_admin()
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir) / "media", MEDIA_URL="media/"):
            media_root = Path(settings.MEDIA_ROOT)
            progress_pdf = media_root / "project-documents" / "T0001" / "week-1.pdf"
            progress_pdf.parent.mkdir(parents=True, exist_ok=True)
            progress_pdf.write_bytes(b"%PDF-1.4\n% Progress\n%%EOF\n")
            document = ProjectDocument.objects.create(
                project=self.project,
                doc_type=ProjectDocument.DocumentType.PDF,
                document_kind=ProjectDocument.DocumentKind.PROGRESS,
                title="第 1 周进度",
                description="完成数据清洗",
                path="media/project-documents/T0001/week-1.pdf",
                content_hash="progress-hash",
                uploaded_by=admin,
            )
            ProjectProgressEntry.objects.create(
                project=self.project,
                entry_type=ProjectProgressEntry.EntryType.DOCUMENT,
                title="上传第 1 周进度",
                description="完成数据清洗",
                document=document,
                created_by=admin,
            )

            export_response = self.client.get("/api/admin/content-backup/export/")
            self.assertEqual(export_response.status_code, 200)
            backup_bytes = export_response.content
            with zipfile.ZipFile(io.BytesIO(backup_bytes)) as archive:
                manifest = json.loads(archive.read("openmedailab-backup.json").decode("utf-8"))
                self.assertEqual(manifest["counts"]["project_progress_entries"], 1)
                self.assertIn("project_progress_entries", manifest)
                self.assertNotIn("uploaded_by", json.dumps(manifest, ensure_ascii=False))
                self.assertNotIn("created_by", json.dumps(manifest, ensure_ascii=False))

            ProjectProgressEntry.objects.all().delete()
            ProjectDocument.objects.all().delete()
            progress_pdf.unlink()
            restore_response = self.client.post(
                "/api/admin/content-backup/restore/",
                {"file": SimpleUploadedFile("backup.zip", backup_bytes, content_type="application/zip")},
            )
            self.assertEqual(restore_response.status_code, 200)
            self.assertEqual(restore_response.json()["data"]["project_progress_entries"], 1)
            restored_document = ProjectDocument.objects.get(document_kind=ProjectDocument.DocumentKind.PROGRESS)
            restored_entry = ProjectProgressEntry.objects.get(project=self.project)
            self.assertIsNone(restored_document.uploaded_by)
            self.assertIsNone(restored_entry.created_by)
            self.assertEqual(restored_entry.document, restored_document)

    def test_import_project_bundle_binds_pdf_documents(self):
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir) / "media", MEDIA_URL="media/"):
            source_dir = Path(tmpdir) / "source"
            source_dir.mkdir()
            pdf_path = source_dir / "detail.pdf"
            pdf_path.write_bytes(b"%PDF-1.4\n% OpenMedAILab test PDF\n%%EOF\n")
            project_json = source_dir / "projects.json"
            document_json = source_dir / "documents.json"
            project_json.write_text(
                json.dumps(
                    {
                        "projects": [
                            {
                                "id": "T0002",
                                "theme": "FFA",
                                "title": "FFA 图文证据链病例复核基准",
                                "summary": "围绕 FFA 图文证据链构建可复核开放课题。",
                                "tags": ["FFA", "RAG"],
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            document_json.write_text(
                json.dumps(
                    [
                        {
                            "id": "T0002",
                            "pdf_path": str(pdf_path),
                            "doc_type": "pdf",
                            "document_title": "项目详细说明",
                            "description": "完整课题方案 PDF",
                        }
                    ],
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            call_command("import_project_bundle", projects=str(project_json), documents=str(document_json), publish=True)

            project = Project.objects.get(topic_id=2)
            self.assertTrue(project.is_public)
            self.assertEqual(project.stage, ProjectStage.OPEN_RECRUITING)
            document = project.documents.get()
            self.assertEqual(document.doc_type, ProjectDocument.DocumentType.PDF)
            self.assertEqual(document.title, "项目详细说明")
            self.assertEqual(document.description, "完整课题方案 PDF")
            self.assertTrue(document.path.endswith("media/project-documents/T0002/detail.pdf"))
            self.assertTrue((Path(tmpdir) / "media" / "project-documents" / "T0002" / "detail.pdf").exists())

            public_response = self.client.get(f"/api/projects/{project.pk}/")
            self.assertEqual(public_response.status_code, 200)
            public_document = public_response.json()["data"]["documents"][0]
            self.assertEqual(public_document["doc_type"], "pdf")
            self.assertEqual(public_document["path"], document.path)

    def test_import_project_bundle_discovers_json_and_matching_pdf_from_source_directory(self):
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir) / "media", MEDIA_URL="media/"):
            Project.objects.create(
                topic_id=2,
                title="已有第二个课题",
                summary="用于验证目录导入自动从 T0003 开始。",
                theme=self.theme,
                stage=ProjectStage.OPEN_RECRUITING,
                is_public=True,
            )
            source_dir = Path(tmpdir) / "topics"
            source_dir.mkdir()
            topic_json = source_dir / "001_topic.json"
            topic_pdf = source_dir / "001_topic.pdf"
            orphan_pdf = source_dir / "orphan.pdf"
            notes_md = source_dir / "notes.md"
            non_project_json = source_dir / "metadata.json"
            no_pdf_json = source_dir / "002_no_pdf.json"
            topic_pdf.write_bytes(b"%PDF-1.4\n% OpenMedAILab source directory PDF\n%%EOF\n")
            orphan_pdf.write_bytes(b"%PDF-1.4\n% This file must be ignored\n%%EOF\n")
            notes_md.write_text("# This file must be ignored\n", encoding="utf-8")
            non_project_json.write_text(json.dumps({"documents": []}), encoding="utf-8")
            topic_json.write_text(
                json.dumps(
                    {
                        "id": "T0003",
                        "theme": "FFA",
                        "title": "目录自动发现课题",
                        "summary": "从同一目录自动发现 JSON 和 PDF。",
                        "tags": ["FFA"],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            no_pdf_json.write_text(
                json.dumps(
                    {
                        "id": "T0004",
                        "theme": "FFA",
                        "title": "只有 JSON 没有 PDF 的课题",
                        "summary": "目录导入时没有同名 PDF 也可以导入课题。",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            call_command("import_project_bundle", "--source", str(source_dir), "--publish")

            project = Project.objects.get(topic_id=3)
            document = project.documents.get()
            self.assertEqual(document.doc_type, ProjectDocument.DocumentType.PDF)
            self.assertEqual(document.title, "项目详细说明")
            self.assertTrue(document.path.endswith("media/project-documents/T0003/001_topic.pdf"))
            self.assertTrue((Path(tmpdir) / "media" / "project-documents" / "T0003" / "001_topic.pdf").exists())
            self.assertTrue(Project.objects.filter(topic_id=4).exists())
            self.assertFalse(Project.objects.get(topic_id=4).documents.exists())
            self.assertFalse(ProjectDocument.objects.filter(path__contains="orphan.pdf").exists())

    def test_admin_content_backup_exports_and_restores_projects_themes_and_pdfs(self):
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir) / "media", MEDIA_URL="media/"):
            media_root = Path(settings.MEDIA_ROOT)
            project_pdf = media_root / "project-documents" / "T0001" / "detail.pdf"
            dataset_pdf = media_root / "theme-datasets" / "antivegf" / "dataset.pdf"
            project_pdf.parent.mkdir(parents=True, exist_ok=True)
            dataset_pdf.parent.mkdir(parents=True, exist_ok=True)
            project_pdf.write_bytes(b"%PDF-1.4\n% Project detail\n%%EOF\n")
            dataset_pdf.write_bytes(b"%PDF-1.4\n% Dataset description\n%%EOF\n")
            ProjectDocument.objects.create(
                project=self.project,
                doc_type=ProjectDocument.DocumentType.PDF,
                document_kind=ProjectDocument.DocumentKind.DETAIL,
                title="课题完整方案",
                description="课题 PDF 详情",
                path="media/project-documents/T0001/detail.pdf",
                content_hash="old-project-hash",
            )
            ThemeFile.objects.create(
                theme=self.theme,
                section="数据集说明文件",
                file_type=ThemeFile.FileType.DATASET_META,
                title="AntiVEGF 数据集说明",
                description="数据集 PDF 详情",
                path="media/theme-datasets/antivegf/dataset.pdf",
                detail_pdf_title="数据集说明 PDF",
                detail_pdf_path="media/theme-datasets/antivegf/dataset.pdf",
                detail_pdf_hash="old-dataset-hash",
                is_active=True,
            )
            admin = self.login_platform_admin()
            participant = User.objects.create_user(username="backup_relation_user", email="backup-relation@example.com", password="StrongPass12345")
            interest = ProjectInterest.objects.create(user=participant, project=self.project, role="学生", status=InteractionStatus.APPROVED)
            sponsor = SponsorIntent.objects.create(user=participant, project=self.project, sponsor_type="compute", status=InteractionStatus.APPROVED)
            contribution = Contribution.objects.create(user=participant, project=self.project, title="备份外任务结果", result_type=Contribution.ResultType.STAGE)
            ledger = CreditLedger.objects.create(
                user=participant,
                project=self.project,
                action_type=CreditLedger.ActionType.ADMIN_ADJUST,
                amount=1,
                balance_after=101,
                created_by=admin,
            )
            user_count = User.objects.count()
            audit_before = AuditLog.objects.count()

            export_response = self.client.get("/api/admin/content-backup/export/")

            self.assertEqual(export_response.status_code, 200)
            self.assertEqual(export_response.headers["Content-Type"], "application/zip")
            self.assertIn("openmedailab-content-backup", export_response.headers["Content-Disposition"])
            backup_bytes = export_response.content
            with zipfile.ZipFile(io.BytesIO(backup_bytes)) as archive:
                manifest = json.loads(archive.read("openmedailab-backup.json").decode("utf-8"))
                self.assertEqual(manifest["counts"]["themes"], 1)
                self.assertEqual(manifest["counts"]["projects"], 1)
                self.assertIn("files/project-documents/T0001/detail.pdf", archive.namelist())
                self.assertIn("files/theme-datasets/antivegf/dataset.pdf", archive.namelist())

            self.theme.name = "被污染的主题"
            self.theme.save(update_fields=["name", "updated_at"])
            self.project.title = "被污染的课题"
            self.project.summary = "被污染的摘要"
            self.project.save(update_fields=["title", "summary", "updated_at"])
            self.project.tags.clear()
            ProjectDocument.objects.all().delete()
            ThemeFile.objects.all().delete()
            project_pdf.unlink()
            dataset_pdf.unlink()

            restore_response = self.client.post(
                "/api/admin/content-backup/restore/",
                {"file": SimpleUploadedFile("backup.zip", backup_bytes, content_type="application/zip")},
            )

            self.assertEqual(restore_response.status_code, 200)
            restore_payload = restore_response.json()["data"]
            self.assertEqual(restore_payload["themes"], 1)
            self.assertEqual(restore_payload["projects"], 1)
            self.assertEqual(restore_payload["project_documents"], 1)
            self.assertEqual(restore_payload["theme_files"], 1)
            self.theme.refresh_from_db()
            self.project.refresh_from_db()
            self.assertEqual(self.theme.name, "AntiVEGF")
            self.assertEqual(self.project.title, "纵向病例证据 RAG")
            self.assertEqual(list(self.project.tags.values_list("slug", flat=True)), ["rag"])
            self.assertEqual(self.project.documents.get().title, "课题完整方案")
            self.assertEqual(ThemeFile.objects.get(theme=self.theme).detail_pdf_title, "数据集说明 PDF")
            self.assertTrue(project_pdf.exists())
            self.assertTrue(dataset_pdf.exists())
            self.assertEqual(User.objects.count(), user_count)
            self.assertTrue(ProjectInterest.objects.filter(pk=interest.pk).exists())
            self.assertTrue(SponsorIntent.objects.filter(pk=sponsor.pk).exists())
            self.assertTrue(Contribution.objects.filter(pk=contribution.pk).exists())
            self.assertTrue(CreditLedger.objects.filter(pk=ledger.pk).exists())
            self.assertGreater(AuditLog.objects.count(), audit_before)
            self.assertTrue(AuditLog.objects.filter(actor=admin, action="content_backup.export", status="success").exists())
            self.assertTrue(AuditLog.objects.filter(actor=admin, action="content_backup.restore", status="success").exists())

    def test_regular_user_cannot_manage_content(self):
        user = User.objects.create_user(username="normaluser", password="StrongPass12345")
        self.client.force_login(user)

        response = self.post_json("/api/admin/themes/", {"name": "不应创建"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "permission_denied")
        self.assertTrue(
            AuditLog.objects.filter(
                actor=user,
                action="permission.denied",
                target_type="Capability",
                target_id="manage_themes",
                status="failed",
                error_code="permission_denied",
            ).exists()
        )

    def test_project_status_card_exposes_uid_and_contact_groups_for_authenticated_viewer(self):
        student = User.objects.create_user(username="studentuid", email="studentuid@example.com", password="StrongPass12345")
        doctor = User.objects.create_user(username="doctoruid", email="doctoruid@example.com", password="StrongPass12345")
        pending = User.objects.create_user(username="pendinguid", email="pendinguid@example.com", password="StrongPass12345")
        follower = User.objects.create_user(username="followeruid", email="followeruid@example.com", password="StrongPass12345")
        ProjectInterest.objects.create(
            user=student,
            project=self.project,
            role="学生",
            available_hours_per_week=4,
            status=InteractionStatus.APPROVED,
        )
        ProjectClaimIntent.objects.create(user=doctor, project=self.project, claim_type="leader", status=InteractionStatus.APPROVED)
        SponsorIntent.objects.create(user=student, project=self.project, sponsor_type="compute", status=InteractionStatus.APPROVED)
        ProjectInterest.objects.create(
            user=pending,
            project=self.project,
            role="医生",
            available_hours_per_week=2,
            status=InteractionStatus.PENDING,
        )

        anonymous_response = self.client.get(f"/api/projects/{self.project.pk}/status-card/")
        self.assertEqual(anonymous_response.status_code, 200)
        anonymous = anonymous_response.json()["data"]
        self.assertEqual(anonymous["participants"]["count"], 2)
        self.assertEqual(anonymous["participants"]["uids"], [])
        self.assertFalse(anonymous["participants"]["uids_visible"])
        self.assertFalse(anonymous["uid_groups"]["uids_visible"])
        self.assertEqual(anonymous["uid_groups"]["groups"], [])

        hidden_project = Project.objects.create(
            topic_id=9,
            title="管理员任务管理私有课题",
            summary="用于验证管理员可以读取非公开课题状态卡。",
            theme=self.theme,
            stage=ProjectStage.TEAM_BUILDING,
            is_public=False,
        )
        hidden_anonymous_response = self.client.get(f"/api/projects/{hidden_project.pk}/status-card/")
        self.assertEqual(hidden_anonymous_response.status_code, 404)

        admin = self.login_platform_admin()
        hidden_admin_response = self.client.get(f"/api/projects/{hidden_project.pk}/status-card/")
        self.assertEqual(hidden_admin_response.status_code, 200)
        self.assertEqual(hidden_admin_response.json()["data"]["project"]["id"], hidden_project.pk)

        self.client.force_login(student)
        ProjectFollow.objects.create(user=student, project=self.project)
        response = self.client.get(f"/api/projects/{self.project.pk}/status-card/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertIn("uid", payload["viewer_state"])
        self.assertEqual(payload["viewer_state"]["uid"], student.profile.uid)
        self.assertTrue(payload["viewer_state"]["is_following"])
        self.assertIn("activity_labels", payload["viewer_state"])
        self.assertIn("已收藏", payload["viewer_state"]["activity_labels"])
        self.assertTrue(payload["participants"]["uids_visible"])
        self.assertEqual(set(payload["participants"]["uids"]), {student.profile.uid, doctor.profile.uid})
        self.assertTrue(payload["uid_groups"]["uids_visible"])
        group_labels = [group["label"] for group in payload["uid_groups"]["groups"]]
        self.assertEqual(
            group_labels,
            ["收藏", "参与：学生（已通过）", "参与：医生（待处理）", "认领项目负责人（已通过）", "资助：资助算力（已通过）"],
        )
        uid_groups = {group["label"]: set(group["uids"]) for group in payload["uid_groups"]["groups"]}
        self.assertIn(student.profile.uid, uid_groups["收藏"])
        self.assertIn(student.profile.uid, uid_groups["参与：学生（已通过）"])
        self.assertIn(pending.profile.uid, uid_groups["参与：医生（待处理）"])
        self.assertIn(doctor.profile.uid, uid_groups["认领项目负责人（已通过）"])
        self.assertIn(student.profile.uid, uid_groups["资助：资助算力（已通过）"])
        self.assertNotIn("studentuid@example.com", json.dumps(payload, ensure_ascii=False))
        contact_groups = {group["key"]: group["members"] for group in payload["project"]["team_contact_groups"]}
        self.assertEqual(contact_groups["student"][0]["uid"], student.profile.uid)
        self.assertEqual(contact_groups["student"][0]["name"], "studentuid")
        self.assertIn("wechat", contact_groups["student"][0])

        self.client.force_login(follower)
        ProjectFollow.objects.create(user=follower, project=self.project)
        follower_response = self.client.get(f"/api/projects/{self.project.pk}/status-card/")
        self.assertEqual(follower_response.status_code, 200)
        follower_payload = follower_response.json()["data"]
        self.assertEqual(follower_payload["status_uids"]["highlight_uid"], follower.profile.uid)
        self.assertIn(follower.profile.uid, follower_payload["status_uids"]["uids"])
        self.assertEqual(follower_payload["participants"]["count"], 2)
        follow_group = next(group for group in follower_payload["uid_groups"]["groups"] if group["key"] == "follow")
        self.assertEqual(follow_group["uids"], sorted([student.profile.uid, follower.profile.uid]))

    def test_status_card_structured_sponsor_groups_filter_approved_for_admin_task(self):
        pending = User.objects.create_user(username="pendingtaskfund", email="pendingtaskfund@example.com", password="StrongPass12345")
        approved = User.objects.create_user(username="approvedtaskfund", email="approvedtaskfund@example.com", password="StrongPass12345")
        rejected = User.objects.create_user(username="rejectedtaskfund", email="rejectedtaskfund@example.com", password="StrongPass12345")
        SponsorIntent.objects.create(user=pending, project=self.project, sponsor_type="compute", status=InteractionStatus.PENDING)
        SponsorIntent.objects.create(user=approved, project=self.project, sponsor_type="labor_fee", status=InteractionStatus.APPROVED)
        SponsorIntent.objects.create(user=rejected, project=self.project, sponsor_type="token", status=InteractionStatus.REJECTED)

        self.client.force_login(approved)
        response = self.client.get(f"/api/projects/{self.project.pk}/status-card/")

        self.assertEqual(response.status_code, 200)
        groups = response.json()["data"]["uid_groups"]["groups"]
        sponsor_groups = [group for group in groups if group["type"] == "sponsor"]
        self.assertTrue(sponsor_groups)
        for group in sponsor_groups:
            self.assertIn("status", group)
            self.assertIn("status_label", group)
            self.assertIn("subtype", group)
            self.assertIn("subtype_label", group)
        approved_groups = [group for group in sponsor_groups if group["status"] == InteractionStatus.APPROVED]
        self.assertEqual(len(approved_groups), 1)
        self.assertEqual(approved_groups[0]["subtype"], "labor_fee")
        self.assertEqual(approved_groups[0]["uids"], [approved.profile.uid])
        self.assertFalse(any(group["status"] == InteractionStatus.PENDING and group.get("label") == "已获批资助" for group in sponsor_groups))

    def test_interest_auto_approves_and_admin_reviews_claims_and_sponsors(self):
        applicant = User.objects.create_user(username="applicant", email="applicant@example.com", password="StrongPass12345")
        self.client.force_login(applicant)

        interest_response = self.post_json(
            f"/api/projects/{self.project.pk}/interest/",
            {"role": "学生", "available_hours_per_week": 6, "message": "申请参与"},
        )
        self.assertEqual(interest_response.status_code, 201)
        interest = ProjectInterest.objects.get(user=applicant, project=self.project, role="学生")
        interest.refresh_from_db()
        self.assertEqual(interest.status, InteractionStatus.APPROVED)
        self.project.refresh_from_db()
        self.assertEqual(self.project.stage, ProjectStage.TEAM_BUILDING)

        teacher = User.objects.create_user(username="teacher", email="teacher@example.com", password="StrongPass12345")
        teacher.profile.role_type = RoleType.PHD_OR_ABOVE
        teacher.profile.save(update_fields=["role_type", "updated_at"])
        self.client.force_login(teacher)
        teacher_response = self.post_json(
            f"/api/projects/{self.project.pk}/interest/",
            {
                "role": "大学老师",
                "available_hours_per_week": 4,
                "message": "参与开放课题协作",
                "authorship_intention": "contribution",
            },
        )
        self.assertEqual(teacher_response.status_code, 201)
        self.assertEqual(ProjectInterest.objects.get(user=teacher, project=self.project).role, "大学老师")

        self.client.force_login(applicant)

        claim_response = self.post_json(
            f"/api/projects/{self.project.pk}/claim/",
            {"claim_type": "leader", "message": "认领项目负责人"},
        )
        self.assertEqual(claim_response.status_code, 201)
        claim = ProjectClaimIntent.objects.get(user=applicant, project=self.project, claim_type="leader")
        self.assertEqual(claim.status, InteractionStatus.PENDING)

        sponsor_response = self.post_json(
            f"/api/projects/{self.project.pk}/sponsor/",
            {"sponsor_type": "compute", "note": "提供算力"},
        )
        self.assertEqual(sponsor_response.status_code, 201)
        sponsor = SponsorIntent.objects.get(user=applicant, project=self.project, sponsor_type="compute")
        self.assertEqual(sponsor.status, InteractionStatus.PENDING)

        forbidden_response = self.client.get("/api/admin/interactions/")
        self.assertEqual(forbidden_response.status_code, 403)

        admin = self.login_platform_admin()
        overview_response = self.client.get("/api/admin/overview/")
        self.assertEqual(overview_response.status_code, 200)
        self.assertEqual(overview_response.json()["data"]["counts"]["pending_interactions"], 2)

        list_response = self.client.get("/api/admin/interactions/?status=pending")
        self.assertEqual(list_response.status_code, 200)
        rows = list_response.json()["data"]["results"]
        self.assertEqual({row["type"] for row in rows}, {"claim", "sponsor"})
        self.assertEqual({row["user"]["uid"] for row in rows}, {applicant.profile.uid})
        self.assertTrue(any(row["subtype"] == "leader" for row in rows))
        self.assertTrue(any(row["subtype"] == "compute" for row in rows))
        self.assertNotIn("applicant@example.com", json.dumps(rows, ensure_ascii=False))
        self.assertNotIn("applicant", json.dumps(rows, ensure_ascii=False))

        invalid_review_response = self.patch_json(
            f"/api/admin/interactions/interest/{interest.pk}/status/",
            {"status": "rejected", "review_note": "管理员不再审核参与"},
        )
        self.assertEqual(invalid_review_response.status_code, 422)
        self.assertEqual(invalid_review_response.json()["error"]["code"], "invalid_interaction_type")
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="interaction.review",
                target_type="Interaction",
                target_id=str(interest.pk),
                status="failed",
                error_code="invalid_interaction_type",
            ).exists()
        )

        invalid_status_response = self.patch_json(
            f"/api/admin/interactions/sponsor/{sponsor.pk}/status/",
            {"status": "pending", "review_note": "非法状态"},
        )
        self.assertEqual(invalid_status_response.status_code, 422)
        self.assertEqual(invalid_status_response.json()["error"]["code"], "validation_error")
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="interaction.review",
                target_type="SponsorIntent",
                target_id=str(sponsor.pk),
                status="failed",
                error_code="validation_error",
            ).exists()
        )

        claim_review_response = self.patch_json(
            f"/api/admin/interactions/claim/{claim.pk}/status/",
            {"status": "approved", "review_note": "负责人认领通过"},
        )
        self.assertEqual(claim_review_response.status_code, 200)
        claim.refresh_from_db()
        self.assertEqual(claim.status, InteractionStatus.APPROVED)
        self.assertEqual(claim.review_comment, "负责人认领通过")
        self.assertEqual(claim.reviewed_by, admin)

        review_response = self.patch_json(
            f"/api/admin/interactions/sponsor/{sponsor.pk}/status/",
            {"status": "approved", "review_note": "资助已确认"},
        )

        self.assertEqual(review_response.status_code, 200)
        sponsor.refresh_from_db()
        self.project.refresh_from_db()
        self.assertEqual(sponsor.status, InteractionStatus.APPROVED)
        self.assertEqual(sponsor.review_comment, "资助已确认")
        self.assertEqual(sponsor.reviewed_by, admin)
        self.assertIsNotNone(sponsor.reviewed_at)
        self.assertEqual(self.project.stage, ProjectStage.TEAM_BUILDING)
        response_payload = review_response.json()["data"]
        self.assertEqual(response_payload["review_comment"], "资助已确认")
        self.assertEqual(response_payload["reviewed_by"]["uid"], admin.profile.uid)
        self.assertEqual(response_payload["detail"]["review_comment"], "资助已确认")
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="interaction.review",
                target_type="SponsorIntent",
                target_id=str(sponsor.pk),
                after__review_note="资助已确认",
                status="success",
            ).exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(
                action="project.stage_auto_team_building",
                target_type="Project",
                target_id=str(self.project.pk),
                after__stage=ProjectStage.TEAM_BUILDING,
            ).exists()
        )
        rereview_response = self.patch_json(f"/api/admin/interactions/sponsor/{sponsor.pk}/status/", {"status": "rejected"})
        self.assertEqual(rereview_response.status_code, 422)
        self.assertEqual(rereview_response.json()["error"]["code"], "interaction_not_pending")
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="interaction.review",
                target_type="SponsorIntent",
                target_id=str(sponsor.pk),
                status="failed",
                error_code="interaction_not_pending",
            ).exists()
        )
        audit_response = self.client.get("/api/admin/audit-logs/?action=interaction.review")
        self.assertEqual(audit_response.status_code, 200)
        audit_entry = audit_response.json()["data"]["results"][0]
        self.assertEqual(audit_entry["action_label"], "审核协作意向")
        self.assertIn(applicant.profile.uid, audit_entry["summary"])
        self.assertIn("已通过", audit_entry["summary"])
        self.assertNotIn('{"id"', audit_entry["summary"])

    def test_sponsor_review_note_is_persisted_and_visible_to_applicant(self):
        sponsor_user = User.objects.create_user(username="sponsorreview", email="sponsorreview@example.com", password="StrongPass12345")
        intent = SponsorIntent.objects.create(user=sponsor_user, project=self.project, sponsor_type="compute", status=InteractionStatus.PENDING)
        admin = self.login_platform_admin()

        response = self.patch_json(
            f"/api/admin/interactions/sponsor/{intent.pk}/status/",
            {"status": "rejected", "review_note": "算力额度信息不足"},
        )

        self.assertEqual(response.status_code, 200)
        intent.refresh_from_db()
        self.assertEqual(intent.review_comment, "算力额度信息不足")
        self.assertEqual(intent.reviewed_by, admin)
        self.assertIsNotNone(intent.reviewed_at)
        self.assertEqual(response.json()["data"]["review_comment"], "算力额度信息不足")
        self.assertEqual(response.json()["data"]["reviewed_by"]["uid"], admin.profile.uid)

        list_response = self.client.get("/api/admin/interactions/?type=sponsor")
        self.assertEqual(list_response.status_code, 200)
        admin_row = next(item for item in list_response.json()["data"]["results"] if item["id"] == intent.pk)
        self.assertEqual(admin_row["review_comment"], "算力额度信息不足")
        self.assertEqual(admin_row["reviewed_by"]["uid"], admin.profile.uid)
        self.assertEqual(admin_row["detail"]["review_comment"], "算力额度信息不足")

        self.client.force_login(sponsor_user)
        dashboard = self.client.get("/api/me/dashboard/").json()["data"]
        row = next(item for item in dashboard["sponsors"] if item["id"] == intent.pk)
        self.assertEqual(row["review_comment"], "算力额度信息不足")
        self.assertEqual(row["reviewed_by"]["uid"], admin.profile.uid)

    def test_resubmitting_approved_sponsor_does_not_reset_status(self):
        sponsor_user = User.objects.create_user(username="sponsorrepeat", email="sponsorrepeat@example.com", password="StrongPass12345")
        intent = SponsorIntent.objects.create(user=sponsor_user, project=self.project, sponsor_type="compute", status=InteractionStatus.APPROVED)
        self.client.force_login(sponsor_user)

        response = self.post_json(
            f"/api/projects/{self.project.pk}/sponsor/",
            {"sponsor_type": "compute", "note": "补充说明"},
        )

        self.assertEqual(response.status_code, 200)
        intent.refresh_from_db()
        self.assertEqual(intent.status, InteractionStatus.APPROVED)
        self.assertEqual(intent.note, "补充说明")

    def test_claim_slots_are_unique_and_first_unit_is_structured(self):
        leader_user = User.objects.create_user(username="leaderclaimant", email="leaderclaimant@example.com", password="StrongPass12345")
        first_unit_user = User.objects.create_user(username="firstunitclaimant", email="firstunitclaimant@example.com", password="StrongPass12345")
        next_user = User.objects.create_user(username="nextclaimant", email="nextclaimant@example.com", password="StrongPass12345")

        self.client.force_login(leader_user)
        leader_response = self.post_json(
            f"/api/projects/{self.project.pk}/claim/",
            {"claim_type": "leader", "message": "申请担任项目负责人"},
        )
        self.assertEqual(leader_response.status_code, 201)
        leader_claim = ProjectClaimIntent.objects.get(user=leader_user, project=self.project, claim_type="leader")
        self.assertEqual(leader_claim.status, InteractionStatus.PENDING)

        duplicate_own_response = self.post_json(
            f"/api/projects/{self.project.pk}/claim/",
            {"claim_type": "leader", "message": "重复申请负责人"},
        )
        self.assertEqual(duplicate_own_response.status_code, 422)
        self.assertEqual(duplicate_own_response.json()["error"]["code"], "claim_already_active")

        self.client.force_login(first_unit_user)
        occupied_leader_response = self.post_json(
            f"/api/projects/{self.project.pk}/claim/",
            {"claim_type": "leader", "message": "另一个负责人申请"},
        )
        self.assertEqual(occupied_leader_response.status_code, 409)
        self.assertEqual(occupied_leader_response.json()["error"]["code"], "claim_slot_occupied")

        missing_unit_response = self.post_json(
            f"/api/projects/{self.project.pk}/claim/",
            {"claim_type": "paper_first_unit", "message": "申请第一单位"},
        )
        self.assertEqual(missing_unit_response.status_code, 422)
        self.assertEqual(missing_unit_response.json()["error"]["code"], "paper_first_unit_required")

        first_unit_response = self.post_json(
            f"/api/projects/{self.project.pk}/claim/",
            {
                "claim_type": "paper_first_unit",
                "claimed_unit_name": "中山大学附属第一医院",
            },
        )
        self.assertEqual(first_unit_response.status_code, 201)
        first_unit_payload = first_unit_response.json()["data"]
        self.assertEqual(first_unit_payload["claimed_unit_name"], "中山大学附属第一医院")
        self.assertIn("中山大学附属第一医院", first_unit_payload["message"])

        self.client.force_login(next_user)
        occupied_unit_response = self.post_json(
            f"/api/projects/{self.project.pk}/claim/",
            {
                "claim_type": "paper_first_unit",
                "claimed_unit_name": "北京协和医院",
            },
        )
        self.assertEqual(occupied_unit_response.status_code, 409)
        self.assertEqual(occupied_unit_response.json()["error"]["code"], "claim_slot_occupied")

        admin = self.login_platform_admin()
        claim_review_response = self.patch_json(
            f"/api/admin/interactions/claim/{leader_claim.pk}/status/",
            {"status": "approved", "review_note": "负责人认领通过"},
        )
        self.assertEqual(claim_review_response.status_code, 200)
        leader_claim.refresh_from_db()
        self.assertEqual(leader_claim.status, InteractionStatus.APPROVED)

        self.client.force_login(leader_user)
        withdraw_response = self.patch_json(
            f"/api/me/interactions/claim/{leader_claim.pk}/withdraw/",
            {"reason": "用户主动撤回项目负责人认领"},
        )
        self.assertEqual(withdraw_response.status_code, 200)
        leader_claim.refresh_from_db()
        self.assertEqual(leader_claim.status, InteractionStatus.WITHDRAWN)

        self.client.force_login(next_user)
        released_leader_response = self.post_json(
            f"/api/projects/{self.project.pk}/claim/",
            {"claim_type": "leader", "message": "释放后申请负责人"},
        )
        self.assertEqual(released_leader_response.status_code, 201)

        self.client.force_login(admin)
        first_unit_claim = ProjectClaimIntent.objects.get(
            user=first_unit_user,
            project=self.project,
            claim_type="paper_first_unit",
        )
        list_response = self.client.get("/api/admin/interactions/?status=pending&type=claim")
        self.assertEqual(list_response.status_code, 200)
        first_unit_row = next(row for row in list_response.json()["data"]["results"] if row["id"] == first_unit_claim.pk)
        self.assertEqual(first_unit_row["detail"]["claimed_unit_name"], "中山大学附属第一医院")

        reject_response = self.patch_json(
            f"/api/admin/interactions/claim/{first_unit_claim.pk}/status/",
            {"status": "rejected", "review_note": "第一单位信息需重新提交"},
        )
        self.assertEqual(reject_response.status_code, 200)
        first_unit_claim.refresh_from_db()
        self.assertEqual(first_unit_claim.status, InteractionStatus.REJECTED)
        self.assertEqual(first_unit_claim.reviewed_by, admin)

        self.client.force_login(next_user)
        released_unit_response = self.post_json(
            f"/api/projects/{self.project.pk}/claim/",
            {
                "claim_type": "paper_first_unit",
                "claimed_unit_name": "北京协和医院",
            },
        )
        self.assertEqual(released_unit_response.status_code, 201)
        self.assertEqual(released_unit_response.json()["data"]["claimed_unit_name"], "北京协和医院")

    def test_pending_review_required_claim_cannot_be_withdrawn_by_user(self):
        user = User.objects.create_user(username="pendingclaimwithdraw", email="pendingclaimwithdraw@example.com", password="StrongPass12345")
        claim = ProjectClaimIntent.objects.create(
            user=user,
            project=self.project,
            claim_type="leader",
            status=InteractionStatus.PENDING,
        )
        self.client.force_login(user)

        response = self.patch_json(f"/api/me/interactions/claim/{claim.pk}/withdraw/", {"reason": "想撤回"})

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "claim_pending_cannot_withdraw")
        claim.refresh_from_db()
        self.assertEqual(claim.status, InteractionStatus.PENDING)
        self.assertTrue(
            AuditLog.objects.filter(
                action="interaction.withdraw",
                target_type="ProjectClaimIntent",
                target_id=str(claim.pk),
                status="failed",
                error_code="claim_pending_cannot_withdraw",
            ).exists()
        )

    def test_claim_availability_reports_action_and_reason_codes(self):
        anonymous_response = self.client.get("/api/projects/?page_size=10")
        self.assertEqual(anonymous_response.status_code, 200)
        anonymous_project = anonymous_response.json()["data"]["results"][0]
        self.assertEqual(anonymous_project["claim_availability"]["leader"]["action"], "unavailable")
        self.assertEqual(anonymous_project["claim_availability"]["leader"]["reason_code"], "login_required")

        claimant = User.objects.create_user(username="availabilityowner", email="availabilityowner@example.com", password="StrongPass12345")
        ProjectClaimIntent.objects.create(
            user=claimant,
            project=self.project,
            claim_type="leader",
            status=InteractionStatus.PENDING,
        )
        self.client.force_login(claimant)
        own_response = self.client.get(f"/api/projects/{self.project.pk}/status-card/")
        self.assertEqual(own_response.status_code, 200)
        own_availability = own_response.json()["data"]["claim_availability"]["leader"]
        self.assertEqual(own_availability["action"], "pending")
        self.assertEqual(own_availability["reason_code"], "own_pending")
        self.assertEqual(own_availability["own_status"], InteractionStatus.PENDING)
        self.assertEqual(own_availability["own_interaction_id"], ProjectClaimIntent.objects.get(user=claimant, project=self.project).pk)
        self.assertIn("项目负责人认领正在管理员审批中", own_availability["reason"])

        ProjectClaimIntent.objects.filter(user=claimant, project=self.project, claim_type="leader").update(
            status=InteractionStatus.APPROVED,
        )
        approved_response = self.client.get(f"/api/projects/{self.project.pk}/status-card/")
        self.assertEqual(approved_response.status_code, 200)
        approved_availability = approved_response.json()["data"]["claim_availability"]["leader"]
        self.assertEqual(approved_availability["action"], "withdraw")
        self.assertEqual(approved_availability["reason_code"], "own_approved")
        self.assertEqual(approved_availability["own_status"], InteractionStatus.APPROVED)
        self.assertIn("可撤回项目负责人认领", approved_availability["reason"])

        ProjectClaimIntent.objects.create(
            user=claimant,
            project=self.project,
            claim_type="paper_first_unit",
            claimed_unit_name="中山大学附属第一医院",
            status=InteractionStatus.PENDING,
        )
        progress_response = self.client.get(f"/api/projects/{self.project.pk}/progress/")
        self.assertEqual(progress_response.status_code, 200)
        progress_project = progress_response.json()["data"]["project"]
        self.assertEqual(progress_project["claim_availability"]["leader"]["action"], "withdraw")
        self.assertEqual(progress_project["claim_availability"]["paper_first_unit"]["action"], "pending")
        self.assertIn("paper_first_unit", progress_project["viewer_state"]["claim_types"])

        other = User.objects.create_user(username="availabilityother", email="availabilityother@example.com", password="StrongPass12345")
        self.client.force_login(other)
        occupied_response = self.client.get("/api/projects/?page_size=10")
        occupied_availability = occupied_response.json()["data"]["results"][0]["claim_availability"]["leader"]
        self.assertEqual(occupied_availability["action"], "unavailable")
        self.assertEqual(occupied_availability["reason_code"], "slot_occupied")

        no_credit_project = Project.objects.create(
            topic_id=2,
            title="积分不足课题",
            summary="无占用席位时展示积分不足原因。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        other.profile.credit_balance = 0
        other.profile.save(update_fields=["credit_balance", "updated_at"])
        insufficient_response = self.client.get(f"/api/projects/{no_credit_project.pk}/status-card/")
        self.assertEqual(insufficient_response.status_code, 200)
        self.assertEqual(
            insufficient_response.json()["data"]["claim_availability"]["leader"]["reason_code"],
            "insufficient_credits",
        )

        no_credit_project.stage = ProjectStage.ACTIVE
        no_credit_project.save(update_fields=["stage", "updated_at"])
        stage_response = self.client.get(f"/api/projects/{no_credit_project.pk}/status-card/")
        self.assertEqual(stage_response.status_code, 200)
        self.assertEqual(
            stage_response.json()["data"]["claim_availability"]["leader"]["reason_code"],
            "stage_not_recruiting",
        )

    def test_project_list_prioritizes_self_relations_before_pagination(self):
        user = User.objects.create_user(username="selfsort", email="selfsort@example.com", password="StrongPass12345")
        low_project = Project.objects.create(
            topic_id=2,
            title="无本人关系的低编号课题",
            summary="用于验证分页前排序。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        claimed_project = Project.objects.create(
            topic_id=9905,
            title="高编号但本人认领课题",
            summary="本人关系应优先。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        sponsored_project = Project.objects.create(
            topic_id=9906,
            title="高编号但本人资助课题",
            summary="本人资助应优先于无关系。",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        ProjectClaimIntent.objects.create(user=user, project=claimed_project, claim_type="leader", status=InteractionStatus.PENDING)
        SponsorIntent.objects.create(user=user, project=sponsored_project, sponsor_type="compute", status=InteractionStatus.PENDING)

        self.client.force_login(user)
        response = self.client.get("/api/projects/?page_size=2&sort=project_id")

        self.assertEqual(response.status_code, 200)
        topic_ids = [row["topic_id"] for row in response.json()["data"]["results"]]
        self.assertEqual(topic_ids, [9905, 9906])
        self.assertNotIn(low_project.topic_id, topic_ids)

    def test_credit_rules_cover_profile_transfer_reserve_and_completion_return(self):
        donor = User.objects.create_user(username="creditdonor", email="creditdonor@example.com", password="StrongPass12345")
        receiver = User.objects.create_user(username="creditreceiver", email="creditreceiver@example.com", password="StrongPass12345")
        self.client.force_login(donor)

        profile_response = self.patch_json(
            "/api/me/profile/",
            {
                "display_name": "积分用户",
                "real_name": "积分用户",
                "role_type": "doctor",
                "organization": "测试医院",
                "research_interests": "医学 AI",
                "skills": "临床审核",
                "contact_email": "creditdonor@example.com",
                "contact_wechat": "credit-donor",
            },
        )
        self.assertEqual(profile_response.status_code, 200)
        donor.profile.refresh_from_db()
        self.assertEqual(donor.profile.credit_balance, 105)
        self.assertTrue(
            CreditLedger.objects.filter(user=donor, action_type=CreditLedger.ActionType.PROFILE_COMPLETION_BONUS).exists()
        )

        transfer_response = self.post_json(
            "/api/me/credits/transfer/",
            {"target_uid": receiver.profile.uid, "amount": 50, "reason": "协作支持"},
        )
        self.assertEqual(transfer_response.status_code, 200)
        donor.profile.refresh_from_db()
        receiver.profile.refresh_from_db()
        self.assertEqual(donor.profile.credit_balance, 55)
        self.assertEqual(receiver.profile.credit_balance, 150)

        transfer_too_much_response = self.post_json(
            "/api/me/credits/transfer/",
            {"target_uid": receiver.profile.uid, "amount": 51},
        )
        self.assertEqual(transfer_too_much_response.status_code, 422)

        participant = User.objects.create_user(username="creditparticipant", email="creditparticipant@example.com", password="StrongPass12345")
        second_project = Project.objects.create(
            topic_id=2,
            title="第二个积分课题",
            summary="第二个积分课题",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        third_project = Project.objects.create(
            topic_id=3,
            title="第三个积分课题",
            summary="第三个积分课题",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        self.client.force_login(participant)
        first_interest_response = self.post_json(
            f"/api/projects/{self.project.pk}/interest/",
            {"role": "学生", "available_hours_per_week": 4, "message": "第一个课题"},
        )
        self.assertEqual(first_interest_response.status_code, 201)
        second_interest_response = self.post_json(
            f"/api/projects/{second_project.pk}/interest/",
            {"role": "学生", "available_hours_per_week": 4, "message": "第二个课题"},
        )
        self.assertEqual(second_interest_response.status_code, 201)
        third_interest_response = self.post_json(
            f"/api/projects/{third_project.pk}/interest/",
            {"role": "学生", "available_hours_per_week": 4, "message": "第三个课题"},
        )
        self.assertEqual(third_interest_response.status_code, 422)
        self.assertEqual(third_interest_response.json()["error"]["code"], "insufficient_credits")

        reserved_transfer_response = self.post_json(
            "/api/me/credits/transfer/",
            {"target_uid": receiver.profile.uid, "amount": 1},
        )
        self.assertEqual(reserved_transfer_response.status_code, 422)
        self.assertEqual(reserved_transfer_response.json()["error"]["code"], "insufficient_credits")

        same_project_claim_response = self.post_json(
            f"/api/projects/{self.project.pk}/claim/",
            {"claim_type": "leader", "message": "同一课题负责人申请"},
        )
        self.assertEqual(same_project_claim_response.status_code, 201)

        self.login_platform_admin()
        active_response = self.patch_json(f"/api/admin/projects/{self.project.pk}/", {"stage": "active"})
        self.assertEqual(active_response.status_code, 200)
        participant.profile.refresh_from_db()
        self.assertEqual(participant.profile.credit_balance, 50)
        self.assertTrue(
            CreditLedger.objects.filter(
                user=participant,
                project=self.project,
                action_type=CreditLedger.ActionType.PROJECT_PARTICIPATION_COST,
                amount=-50,
            ).exists()
        )

        archived_response = self.patch_json(f"/api/admin/projects/{self.project.pk}/", {"stage": "archived"})
        self.assertEqual(archived_response.status_code, 200)
        participant.profile.refresh_from_db()
        self.assertEqual(participant.profile.credit_balance, 150)
        self.assertTrue(
            CreditLedger.objects.filter(
                user=participant,
                project=self.project,
                action_type=CreditLedger.ActionType.PROJECT_COMPLETION_RETURN,
                amount=100,
            ).exists()
        )

    def test_interaction_stage_and_credit_failures_write_failed_audit(self):
        user = User.objects.create_user(username="interactionfail", email="interactionfail@example.com", password="StrongPass12345")
        self.client.force_login(user)
        self.project.stage = ProjectStage.ACTIVE
        self.project.save(update_fields=["stage", "updated_at"])

        interest_response = self.post_json(
            f"/api/projects/{self.project.pk}/interest/",
            {"role": "学生", "available_hours_per_week": 4, "message": "想参与"},
        )
        claim_response = self.post_json(
            f"/api/projects/{self.project.pk}/claim/",
            {"claim_type": "leader", "message": "想认领负责人"},
        )
        sponsor_response = self.post_json(
            f"/api/projects/{self.project.pk}/sponsor/",
            {"sponsor_type": "compute", "note": "提供算力"},
        )

        self.assertEqual(interest_response.status_code, 422)
        self.assertEqual(claim_response.status_code, 422)
        self.assertEqual(sponsor_response.status_code, 422)
        self.assertTrue(AuditLog.objects.filter(actor=user, action="interaction.submit_interest", status="failed", error_code="project_not_recruiting").exists())
        self.assertTrue(AuditLog.objects.filter(actor=user, action="interaction.submit_claim", status="failed", error_code="project_not_recruiting").exists())
        self.assertTrue(AuditLog.objects.filter(actor=user, action="interaction.submit_sponsor", status="failed", error_code="project_not_recruiting").exists())

        self.project.stage = ProjectStage.OPEN_RECRUITING
        self.project.save(update_fields=["stage", "updated_at"])
        user.profile.credit_balance = 0
        user.profile.save(update_fields=["credit_balance", "updated_at"])
        insufficient_interest = self.post_json(
            f"/api/projects/{self.project.pk}/interest/",
            {"role": "学生", "available_hours_per_week": 4, "message": "积分不足参与"},
        )
        insufficient_claim = self.post_json(
            f"/api/projects/{self.project.pk}/claim/",
            {"claim_type": "leader", "message": "积分不足认领"},
        )

        self.assertEqual(insufficient_interest.status_code, 422)
        self.assertEqual(insufficient_interest.json()["error"]["code"], "insufficient_credits")
        self.assertEqual(insufficient_claim.status_code, 422)
        self.assertEqual(insufficient_claim.json()["error"]["code"], "insufficient_credits")
        self.assertTrue(AuditLog.objects.filter(actor=user, action="interaction.submit_interest", status="failed", error_code="insufficient_credits").exists())
        self.assertTrue(AuditLog.objects.filter(actor=user, action="interaction.submit_claim", status="failed", error_code="insufficient_credits").exists())

    def test_project_stage_rolls_back_when_credit_charge_fails(self):
        self.login_platform_admin()
        self.client.raise_request_exception = False
        self.assertEqual(self.project.stage, ProjectStage.OPEN_RECRUITING)

        with patch("api.ninja_api.charge_project_participation_credits_once", side_effect=RuntimeError("charge failed")):
            response = self.patch_json(f"/api/admin/projects/{self.project.pk}/", {"stage": "active"})

        self.project.refresh_from_db()
        self.assertGreaterEqual(response.status_code, 400)
        self.assertEqual(self.project.stage, ProjectStage.OPEN_RECRUITING)

    def test_sponsor_approval_does_not_auto_start_project(self):
        doctor = User.objects.create_user(username="readydoctor", email="readydoctor@example.com", password="StrongPass12345")
        student = User.objects.create_user(username="readystudent", email="readystudent@example.com", password="StrongPass12345")
        mentor = User.objects.create_user(username="readymentor", email="readymentor@example.com", password="StrongPass12345")
        leader = User.objects.create_user(username="readyleader", email="readyleader@example.com", password="StrongPass12345")
        sponsor = User.objects.create_user(username="readyfunder", email="readyfunder@example.com", password="StrongPass12345")
        mentor.profile.role_type = RoleType.PHD_OR_ABOVE
        mentor.profile.save(update_fields=["role_type"])
        ProjectInterest.objects.create(user=doctor, project=self.project, role="医生", status=InteractionStatus.APPROVED)
        ProjectInterest.objects.create(user=student, project=self.project, role="学生", status=InteractionStatus.APPROVED)
        ProjectInterest.objects.create(user=mentor, project=self.project, role="AI工程师", status=InteractionStatus.APPROVED)
        ProjectClaimIntent.objects.create(user=leader, project=self.project, claim_type="leader", status=InteractionStatus.APPROVED)
        pending_sponsor = SponsorIntent.objects.create(user=sponsor, project=self.project, sponsor_type="funding", status=InteractionStatus.PENDING)

        self.project.stage = ProjectStage.TEAM_BUILDING
        self.project.save(update_fields=["stage", "updated_at"])
        admin = self.login_platform_admin()
        response = self.patch_json(
            f"/api/admin/interactions/sponsor/{pending_sponsor.pk}/status/",
            {"status": "approved", "review_note": "启动资助已确认"},
        )

        self.assertEqual(response.status_code, 200)
        self.project.refresh_from_db()
        self.assertEqual(self.project.stage, ProjectStage.TEAM_BUILDING)
        self.assertFalse(
            AuditLog.objects.filter(
                actor=admin,
                action="project.stage_auto_active",
                target_type="Project",
                target_id=str(self.project.pk),
            ).exists()
        )

    def test_sponsor_relation_does_not_allow_task_result_submission(self):
        sponsor = User.objects.create_user(username="sponsoronly", email="sponsoronly@example.com", password="StrongPass12345")
        SponsorIntent.objects.create(user=sponsor, project=self.project, sponsor_type="compute", status=InteractionStatus.APPROVED)
        self.project.stage = ProjectStage.ACTIVE
        self.project.save(update_fields=["stage", "updated_at"])

        self.client.force_login(sponsor)
        response = self.post_json(
            "/api/me/contributions/",
            {
                "project_id": self.project.pk,
                "title": "仅资助者不应能提交",
                "result_type": "stage",
            },
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "interaction_not_approved")

    def test_user_can_withdraw_own_interaction_but_not_others(self):
        owner = User.objects.create_user(username="owner", email="owner@example.com", password="StrongPass12345")
        other = User.objects.create_user(username="other", email="other@example.com", password="StrongPass12345")
        interest = ProjectInterest.objects.create(
            user=owner,
            project=self.project,
            role="学生",
            available_hours_per_week=3,
            status=InteractionStatus.PENDING,
        )

        self.client.force_login(other)
        forbidden_response = self.patch_json(f"/api/me/interactions/interest/{interest.pk}/withdraw/", {})
        self.assertEqual(forbidden_response.status_code, 404)

        self.client.force_login(owner)
        response = self.patch_json(f"/api/me/interactions/interest/{interest.pk}/withdraw/", {})

        self.assertEqual(response.status_code, 200)
        interest.refresh_from_db()
        self.assertEqual(interest.status, InteractionStatus.WITHDRAWN)

    def test_task_contribution_credit_lifecycle(self):
        assignee = User.objects.create_user(username="worker", email="worker@example.com", password="StrongPass12345")
        starting_balance = assignee.profile.credit_balance
        admin = self.login_platform_admin()
        ProjectInterest.objects.create(
            user=assignee,
            project=self.project,
            role="学生",
            available_hours_per_week=4,
            status=InteractionStatus.APPROVED,
        )

        create_response = self.post_json(
            "/api/admin/tasks/",
            {
                "project_id": self.project.pk,
                "title": "整理数据字典",
                "description": "梳理主题数据集说明的关键字段。",
                "task_type": "data_dictionary",
                "required_role": "学生",
                "difficulty": 2,
                "credit_reward": 25,
            },
        )
        self.assertEqual(create_response.status_code, 201)
        task_id = create_response.json()["data"]["id"]

        assign_response = self.post_json(f"/api/admin/tasks/{task_id}/assign/", {"uid": assignee.profile.uid})
        self.assertEqual(assign_response.status_code, 200)
        self.assertEqual(assign_response.json()["data"]["status"], ProjectTask.TaskStatus.CLAIMED)
        self.assertEqual(assign_response.json()["data"]["progress_percent"], 25)
        self.assertEqual(assign_response.json()["data"]["participant_uids"], [assignee.profile.uid])
        self.assertNotIn("worker@example.com", json.dumps(assign_response.json()["data"], ensure_ascii=False))
        self.assertNotIn("worker", json.dumps(assign_response.json()["data"], ensure_ascii=False))

        self.client.force_login(assignee)
        dashboard_response = self.client.get("/api/me/dashboard/")
        self.assertEqual(dashboard_response.status_code, 200)
        self.assertEqual(dashboard_response.json()["data"]["tasks"][0]["id"], task_id)
        self.assertEqual(dashboard_response.json()["data"]["tasks"][0]["participant_uids"], [assignee.profile.uid])

        progress_response = self.patch_json(f"/api/me/tasks/{task_id}/status/", {"status": "in_progress"})
        self.assertEqual(progress_response.status_code, 200)
        self.assertEqual(progress_response.json()["data"]["progress_percent"], 60)

        self.project.stage = ProjectStage.ACTIVE
        self.project.save(update_fields=["stage", "updated_at"])
        contribution_response = self.post_json(
            "/api/me/contributions/",
            {
                "project_id": self.project.pk,
                "task_id": task_id,
                "title": "数据字典初稿",
                "result_type": "stage",
                "description": "已经完成主要字段说明。",
                "file_path": "workspace/data-dictionary.md",
            },
        )
        self.assertEqual(contribution_response.status_code, 201)
        contribution_id = contribution_response.json()["data"]["id"]
        self.assertEqual(contribution_response.json()["data"]["result_type"], "stage")
        self.assertEqual(contribution_response.json()["data"]["result_type_label"], "阶段性成果")
        self.assertEqual(ProjectTask.objects.get(pk=task_id).status, ProjectTask.TaskStatus.DONE)
        self.assertTrue(AuditLog.objects.filter(action="task.result_submit", target_id=str(task_id)).exists())

        self.client.force_login(admin)
        review_response = self.patch_json(
            f"/api/admin/contributions/{contribution_id}/review/",
            {"status": "approved", "review_comment": "可进入数据集说明模块", "grant_reward": True},
        )

        self.assertEqual(review_response.status_code, 200)
        contribution = Contribution.objects.get(pk=contribution_id)
        assignee.profile.refresh_from_db()
        self.assertEqual(contribution.status, ContributionStatus.APPROVED)
        self.assertEqual(review_response.json()["data"]["user"]["uid"], assignee.profile.uid)
        self.assertNotIn("worker@example.com", json.dumps(review_response.json()["data"], ensure_ascii=False))
        self.assertNotIn("worker", json.dumps(review_response.json()["data"], ensure_ascii=False))
        self.assertEqual(assignee.profile.credit_balance, starting_balance + 25)
        self.assertTrue(
            CreditLedger.objects.filter(
                user=assignee,
                task_id=task_id,
                action_type=CreditLedger.ActionType.TASK_REWARD,
                amount=25,
            ).exists()
        )
        self.assertEqual(ProjectTask.objects.get(pk=task_id).status, ProjectTask.TaskStatus.DONE)
        self.assertTrue(AuditLog.objects.filter(action="contribution.review", target_id=str(contribution_id)).exists())

        duplicate_review_response = self.patch_json(
            f"/api/admin/contributions/{contribution_id}/review/",
            {"status": "approved", "review_comment": "重复审核不应重复发奖", "grant_reward": True},
        )
        self.assertEqual(duplicate_review_response.status_code, 200)
        assignee.profile.refresh_from_db()
        self.assertEqual(assignee.profile.credit_balance, starting_balance + 25)
        self.assertEqual(
            CreditLedger.objects.filter(
                user=assignee,
                task_id=task_id,
                action_type=CreditLedger.ActionType.TASK_REWARD,
            ).count(),
            1,
        )
        self.assertFalse(duplicate_review_response.json()["data"]["reviewer"].get("username"))

    def test_task_result_requires_active_project_and_review_status_is_limited(self):
        user = User.objects.create_user(username="resultuser", email="result@example.com", password="StrongPass12345")
        self.client.force_login(user)

        blocked_response = self.post_json(
            "/api/me/contributions/",
            {"project_id": self.project.pk, "title": "开放招募阶段不能交结果"},
        )
        self.assertEqual(blocked_response.status_code, 422)
        self.assertEqual(blocked_response.json()["error"]["code"], "project_not_active")

        self.project.stage = ProjectStage.ACTIVE
        self.project.save(update_fields=["stage", "updated_at"])
        unapproved_response = self.post_json(
            "/api/me/contributions/",
            {"project_id": self.project.pk, "title": "未获批不能交结果"},
        )
        self.assertEqual(unapproved_response.status_code, 403)
        self.assertEqual(unapproved_response.json()["error"]["code"], "interaction_not_approved")

        ProjectInterest.objects.create(
            user=user,
            project=self.project,
            role="学生",
            available_hours_per_week=4,
            status=InteractionStatus.APPROVED,
        )
        invalid_type_response = self.post_json(
            "/api/me/contributions/",
            {"project_id": self.project.pk, "title": "非法结果类型", "result_type": "paper"},
        )
        self.assertEqual(invalid_type_response.status_code, 422)
        self.assertEqual(invalid_type_response.json()["error"]["code"], "validation_error")

        create_response = self.post_json(
            "/api/me/contributions/",
            {"project_id": self.project.pk, "title": "进行中课题任务结果", "result_type": "final"},
        )
        self.assertEqual(create_response.status_code, 201)
        contribution_id = create_response.json()["data"]["id"]
        self.assertEqual(create_response.json()["data"]["result_type"], "final")
        self.assertEqual(create_response.json()["data"]["result_type_label"], "最终结果")

        self.login_platform_admin()
        revision_response = self.patch_json(
            f"/api/admin/contributions/{contribution_id}/review/",
            {"status": "needs_revision", "review_comment": "旧状态不再允许"},
        )
        self.assertEqual(revision_response.status_code, 422)
        contribution = Contribution.objects.get(pk=contribution_id)
        self.assertEqual(contribution.status, ContributionStatus.SUBMITTED)

    def test_task_result_upload_accepts_markdown_for_admin_view_without_review(self):
        user = User.objects.create_user(username="uploader", email="uploader@example.com", password="StrongPass12345")
        ProjectInterest.objects.create(
            user=user,
            project=self.project,
            role="学生",
            available_hours_per_week=4,
            status=InteractionStatus.APPROVED,
        )
        self.project.stage = ProjectStage.ACTIVE
        self.project.save(update_fields=["stage", "updated_at"])

        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir) / "media", MEDIA_URL="media/"):
            self.client.force_login(user)
            response = self.client.post(
                "/api/me/contributions/upload/",
                {
                    "project_id": str(self.project.pk),
                    "title": "阶段结果文档",
                    "result_type": "stage",
                    "description": "包含初步标注和字段说明。",
                    "file": SimpleUploadedFile("result-note.md", b"# Result\n\nready", content_type="text/markdown"),
                },
            )

            self.assertEqual(response.status_code, 201)
            payload = response.json()["data"]
            self.assertEqual(payload["status"], ContributionStatus.SUBMITTED)
            self.assertIn("contribution-documents/", payload["file_path"])
            stored_relative = payload["file_path"].lstrip("/").removeprefix("media/")
            self.assertTrue((Path(settings.MEDIA_ROOT) / stored_relative).is_file())
            self.assertEqual(Contribution.objects.get(pk=payload["id"]).reviewer, None)
            self.assertTrue(AuditLog.objects.filter(action="contribution.submit", target_id=str(payload["id"])).exists())

            self.login_platform_admin()
            admin_response = self.client.get(f"/api/admin/contributions/?project={self.project.topic_id}")
            self.assertEqual(admin_response.status_code, 200)
            self.assertIn(payload["file_path"], json.dumps(admin_response.json()["data"], ensure_ascii=False))

            self.client.force_login(user)
            rejected_response = self.client.post(
                "/api/me/contributions/upload/",
                {
                    "project_id": str(self.project.pk),
                    "title": "非法文件",
                    "result_type": "stage",
                    "file": SimpleUploadedFile("result.exe", b"nope", content_type="application/octet-stream"),
                },
            )
            self.assertEqual(rejected_response.status_code, 422)
            self.assertEqual(rejected_response.json()["error"]["code"], "validation_error")

    def test_task_result_upload_rejects_fake_pdf_and_writes_failed_audit(self):
        user = User.objects.create_user(username="fake_pdf_result", email="fake-pdf-result@example.com", password="StrongPass12345")
        ProjectInterest.objects.create(
            user=user,
            project=self.project,
            role="学生",
            available_hours_per_week=4,
            status=InteractionStatus.APPROVED,
        )
        self.project.stage = ProjectStage.ACTIVE
        self.project.save(update_fields=["stage", "updated_at"])

        self.client.force_login(user)
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(MEDIA_ROOT=Path(tmpdir) / "media", MEDIA_URL="media/"):
            response = self.client.post(
                "/api/me/contributions/upload/",
                {
                    "project_id": str(self.project.pk),
                    "title": "假 PDF 任务结果",
                    "result_type": "stage",
                    "file": SimpleUploadedFile("result.pdf", b"not a pdf", content_type="application/pdf"),
                },
            )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["message"], "PDF 文件格式无法识别。")
        self.assertTrue(
            AuditLog.objects.filter(
                actor=user,
                action="contribution.submit",
                target_type="Project",
                target_id=str(self.project.pk),
                status="failed",
                error_code="validation_error",
            ).exists()
        )

    def test_admin_overview_user_detail_credits_and_audit_logs_are_permissioned(self):
        user = User.objects.create_user(username="detailuser", email="detail@example.com", password="StrongPass12345")
        ProjectFollow.objects.create(user=user, project=self.project)
        CreditLedger.objects.create(
            user=user,
            project=self.project,
            action_type=CreditLedger.ActionType.ADMIN_ADJUST,
            amount=5,
            balance_after=user.profile.credit_balance + 5,
            reason="手动补录",
        )
        AuditLog.objects.create(action="manual.test", target_type="Project", target_id=str(self.project.pk), after={"note": "验收"})

        self.client.force_login(user)
        self.assertEqual(self.client.get("/api/admin/overview/").status_code, 403)
        self.assertEqual(self.client.get(f"/api/admin/users/{user.profile.uid}/").status_code, 403)
        self.assertEqual(self.client.get("/api/admin/audit-logs/").status_code, 403)
        self.assertEqual(self.client.get("/api/admin/credits/").status_code, 403)

        self.login_platform_admin()
        overview_response = self.client.get("/api/admin/overview/")
        self.assertEqual(overview_response.status_code, 200)
        self.assertGreaterEqual(overview_response.json()["data"]["counts"]["users"], 2)

        detail_response = self.client.get(f"/api/admin/users/{user.profile.uid}/")
        self.assertEqual(detail_response.status_code, 200)
        self.assertEqual(detail_response.json()["data"]["user"]["profile"]["uid"], user.profile.uid)
        self.assertEqual(len(detail_response.json()["data"]["follows"]), 1)

        credits_response = self.client.get(f"/api/admin/credits/?uid={user.profile.uid}")
        self.assertEqual(credits_response.status_code, 200)
        self.assertEqual(credits_response.json()["data"]["results"][0]["reason"], "手动补录")
        self.assertEqual(credits_response.json()["data"]["results"][0]["user"]["uid"], user.profile.uid)
        self.assertNotIn("detail@example.com", json.dumps(credits_response.json()["data"]["results"][0], ensure_ascii=False))

        audit_response = self.client.get("/api/admin/audit-logs/?action=manual.test")
        self.assertEqual(audit_response.status_code, 200)
        audit_entry = audit_response.json()["data"]["results"][0]
        self.assertEqual(audit_entry["after"]["note"], "验收")
        self.assertEqual(audit_entry["action_label"], "manual.test")
        self.assertEqual(audit_entry["summary"], "验收")

    def test_register_login_and_interactions(self):
        register_response = self.post_json(
            "/api/auth/register/",
            {
                "username": "apiuser",
                "password1": "StrongPass12345",
                "password2": "StrongPass12345",
                "email": "apiuser@example.com",
                "display_name": "API User",
                "role_type": "undergrad_or_below",
            },
        )
        self.assertEqual(register_response.status_code, 201)
        register_payload = register_response.json()["data"]
        self.assertEqual(register_payload["profile"]["credit_balance"], 100)
        self.assertEqual(register_payload["profile"]["uid"], f"U{register_payload['id']:08d}")
        self.assertNotIn("email_verified", register_payload["profile"])
        self.assertNotIn("email_verified_at", register_payload["profile"])
        self.assertTrue(
            AuditLog.objects.filter(
                actor_id=register_payload["id"],
                action="auth.register",
                target_id=register_payload["profile"]["uid"],
                status="success",
            ).exists()
        )

        follow_response = self.post_json(f"/api/projects/{self.project.pk}/follow/", {})
        self.assertEqual(follow_response.status_code, 200)
        self.assertEqual(ProjectFollow.objects.count(), 1)

        score_response = self.post_json(f"/api/projects/{self.project.pk}/score/", {"score": 9, "comment": "值得做"})
        self.assertEqual(score_response.status_code, 200)
        self.assertEqual(ProjectScore.objects.get().score, 9)

        unscore_response = self.post_json(f"/api/projects/{self.project.pk}/unscore/", {})
        self.assertEqual(unscore_response.status_code, 200)
        self.assertFalse(ProjectScore.objects.filter(project=self.project).exists())

        score_response = self.post_json(f"/api/projects/{self.project.pk}/score/", {"score": 10, "comment": "点赞"})
        self.assertEqual(score_response.status_code, 200)

        interest_response = self.post_json(
            f"/api/projects/{self.project.pk}/interest/",
            {"role": "学生", "available_hours_per_week": 4, "experience": "文献整理", "message": "想参与"},
        )
        self.assertEqual(interest_response.status_code, 201)
        self.assertEqual(ProjectInterest.objects.get().role, "学生")

        dashboard_response = self.client.get("/api/me/dashboard/")
        self.assertEqual(dashboard_response.status_code, 200)
        dashboard_payload = dashboard_response.json()["data"]
        self.assertEqual(len(dashboard_payload["follows"]), 1)
        self.assertEqual(len(dashboard_payload["scores"]), 1)
        self.assertEqual(len(dashboard_payload["interests"]), 1)

    def test_auth_profile_and_password_operations_are_audited(self):
        bad_login = self.post_json("/api/auth/login/", {"username": "missing-user", "password": "WrongPass12345"})
        self.assertEqual(bad_login.status_code, 400)
        self.assertTrue(
            AuditLog.objects.filter(
                actor__isnull=True,
                action="auth.login",
                target_id="missing-user",
                status="failed",
                error_code="invalid_credentials",
            ).exists()
        )
        long_username = "user-" + ("x" * 240)
        long_login = self.post_json("/api/auth/login/", {"username": long_username, "password": "WrongPass12345"})
        self.assertEqual(long_login.status_code, 400)
        long_login_audit = AuditLog.objects.filter(action="auth.login", status="failed").order_by("-created_at").first()
        self.assertLessEqual(len(long_login_audit.target_id), 120)
        self.assertEqual(long_login_audit.target_id, long_username[:120])

        user = User.objects.create_user(username="audituser", email="audituser@example.com", password="StrongPass12345")
        login_response = self.post_json("/api/auth/login/", {"username": "audituser", "password": "StrongPass12345"})
        self.assertEqual(login_response.status_code, 200)
        self.assertTrue(
            AuditLog.objects.filter(
                actor=user,
                action="auth.login",
                target_id=user.profile.uid,
                status="success",
            ).exists()
        )

        profile_response = self.patch_json("/api/me/profile/", {"organization": "审计测试机构", "bio": "只记录非敏感资料"})
        self.assertEqual(profile_response.status_code, 200)
        self.assertTrue(
            AuditLog.objects.filter(
                actor=user,
                action="profile.update",
                target_id=user.profile.uid,
                status="success",
                after__organization="审计测试机构",
            ).exists()
        )

        logout_response = self.post_json("/api/auth/logout/", {})
        self.assertEqual(logout_response.status_code, 200)
        self.assertTrue(
            AuditLog.objects.filter(
                actor=user,
                action="auth.logout",
                target_id=user.profile.uid,
                status="success",
            ).exists()
        )

        user.profile.must_change_password = True
        user.profile.save(update_fields=["must_change_password", "updated_at"])
        self.client.force_login(user)
        change_response = self.post_json(
            "/api/auth/password/change-required/",
            {"password1": "NewStrongPass12345", "password2": "NewStrongPass12345"},
        )
        self.assertEqual(change_response.status_code, 200)
        self.assertTrue(
            AuditLog.objects.filter(
                actor=user,
                action="auth.password_change_required",
                target_id=user.profile.uid,
                status="success",
                after__must_change_password=False,
            ).exists()
        )

    def test_register_validation_errors_include_field_details(self):
        User.objects.create_user(username="existing", email="taken@example.com", password="StrongPass12345")

        duplicate_username = self.post_json(
            "/api/auth/register/",
            {
                "username": "existing",
                "email": "fresh@example.com",
                "display_name": "Duplicate",
                "role_type": "undergrad_or_below",
                "password1": "StrongPass12345",
                "password2": "StrongPass12345",
            },
        )
        self.assertEqual(duplicate_username.status_code, 422)
        self.assertIn("username", duplicate_username.json()["error"]["details"])

        duplicate_email = self.post_json(
            "/api/auth/register/",
            {
                "username": "freshuser",
                "email": "TAKEN@example.com",
                "display_name": "Duplicate Email",
                "role_type": "undergrad_or_below",
                "password1": "StrongPass12345",
                "password2": "StrongPass12345",
            },
        )
        self.assertEqual(duplicate_email.status_code, 422)
        self.assertIn("email", duplicate_email.json()["error"]["details"])

        missing_email = self.post_json(
            "/api/auth/register/",
            {
                "username": "missingemail",
                "display_name": "Missing Email",
                "role_type": "undergrad_or_below",
                "password1": "StrongPass12345",
                "password2": "StrongPass12345",
            },
        )
        self.assertEqual(missing_email.status_code, 422)
        self.assertIn("email", missing_email.json()["error"]["details"])

        invalid_email = self.post_json(
            "/api/auth/register/",
            {
                "username": "bademail",
                "email": "not-an-email",
                "display_name": "Bad Email",
                "role_type": "undergrad_or_below",
                "password1": "StrongPass12345",
                "password2": "StrongPass12345",
            },
        )
        self.assertEqual(invalid_email.status_code, 422)
        self.assertIn("email", invalid_email.json()["error"]["details"])

        weak_password = self.post_json(
            "/api/auth/register/",
            {
                "username": "weakpass",
                "email": "weak@example.com",
                "display_name": "Weak",
                "role_type": "undergrad_or_below",
                "password1": "123",
                "password2": "123",
            },
        )
        self.assertEqual(weak_password.status_code, 422)
        self.assertIn("password2", weak_password.json()["error"]["details"])

        mismatch = self.post_json(
            "/api/auth/register/",
            {
                "username": "mismatch",
                "email": "mismatch@example.com",
                "display_name": "Mismatch",
                "role_type": "undergrad_or_below",
                "password1": "StrongPass12345",
                "password2": "OtherPass12345",
            },
        )
        self.assertEqual(mismatch.status_code, 422)
        self.assertIn("password2", mismatch.json()["error"]["details"])

        invalid_role = self.post_json(
            "/api/auth/register/",
            {
                "username": "badrole",
                "email": "badrole@example.com",
                "display_name": "Bad Role",
                "role_type": "admin",
                "password1": "StrongPass12345",
                "password2": "StrongPass12345",
            },
        )
        self.assertEqual(invalid_role.status_code, 422)
        self.assertIn("role_type", invalid_role.json()["error"]["details"])

    def test_validation_error_exposes_details_and_errors_alias(self):
        response = self.post_json(
            "/api/auth/register/",
            {
                "username": "",
                "email": "bad",
                "display_name": "",
                "role_type": "invalid-role",
                "password1": "x",
                "password2": "y",
            },
        )

        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertIn("details", body["error"])
        self.assertIn("errors", body)
        self.assertEqual(body["errors"], body["error"]["details"])

    def test_profile_contact_email_keeps_global_email_unique(self):
        User.objects.create_user(username="emailowner", email="owner@example.com", password="StrongPass12345")
        user = User.objects.create_user(username="profileeditor", email="editor@example.com", password="StrongPass12345")
        self.client.force_login(user)

        response = self.patch_json("/api/me/profile/", {"contact_email": "OWNER@example.com"})

        self.assertEqual(response.status_code, 422)
        self.assertIn("contact_email", response.json()["error"]["details"])

    def test_profile_contact_email_updates_user_email_and_normalized_profile_email(self):
        user = User.objects.create_user(username="emailsync", email="old@example.com", password="StrongPass12345")
        self.client.force_login(user)

        response = self.patch_json("/api/me/profile/", {"contact_email": "NewAddress@Example.COM"})

        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        user.profile.refresh_from_db()
        self.assertEqual(user.email, "newaddress@example.com")
        self.assertEqual(user.profile.contact_email, "newaddress@example.com")
        self.assertEqual(user.profile.email_normalized, "newaddress@example.com")

    def test_register_uid_prefixes_and_uid_is_immutable(self):
        role_prefixes = {
            "doctor": "D",
            "undergrad_or_below": "U",
            "master_student": "M",
            "phd_student": "P",
            "phd_or_above": "R",
            "engineer": "E",
        }
        for role, prefix in role_prefixes.items():
            response = self.post_json(
                "/api/auth/register/",
                {
                    "username": f"{role}user",
                    "email": f"{role}@example.com",
                    "display_name": role,
                    "role_type": role,
                    "password1": "StrongPass12345",
                    "password2": "StrongPass12345",
                },
            )
            self.assertEqual(response.status_code, 201)
            profile = response.json()["data"]["profile"]
            self.assertTrue(profile["uid"].startswith(prefix))

        meta_response = self.client.get("/api/meta/")
        self.assertEqual(
            [item["value"] for item in meta_response.json()["data"]["profile_roles"]],
            ["doctor", "undergrad_or_below", "master_student", "phd_student", "phd_or_above", "engineer"],
        )

        user = User.objects.get(username="undergrad_or_belowuser")
        self.client.force_login(user)
        original_uid = user.profile.uid
        profile_response = self.patch_json("/api/me/profile/", {"role_type": "doctor"})
        self.assertEqual(profile_response.status_code, 200)
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.uid, original_uid)

    @override_settings(OPENMEDAILAB_DEFAULT_PASSWORD="SystemDefaultPass12345")
    def test_admin_resets_password_to_default_and_user_must_change_before_using_system(self):
        call_command(
            "ensure_platform_admin",
            username="platform_admin",
            email="admin@example.com",
            password="StrongPass12345",
        )
        user = User.objects.create_user(username="resetbyadmin", email="resetbyadmin@example.com", password="StrongPass12345")
        other_user = User.objects.create_user(username="otherreset", email="otherreset@example.com", password="StrongPass12345")
        uid = user.profile.uid

        admin = User.objects.get(username="platform_admin")
        self.client.force_login(admin)
        list_response = self.client.get("/api/admin/users/?q=resetbyadmin")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.json()["data"]["results"][0]["profile"]["uid"], uid)

        reset_response = self.post_json(f"/api/admin/users/{uid}/reset-password/", {})
        self.assertEqual(reset_response.status_code, 200)
        reset_payload = reset_response.json()["data"]
        default_password = reset_payload["default_password"]
        self.assertEqual(default_password, "SystemDefaultPass12345")
        self.assertNotIn("resetbyadmin", default_password)
        self.assertTrue(reset_payload["user"]["profile"]["must_change_password"])

        other_reset_response = self.post_json(f"/api/admin/users/{other_user.profile.uid}/reset-password/", {})
        self.assertEqual(other_reset_response.status_code, 200)
        self.assertEqual(other_reset_response.json()["data"]["default_password"], default_password)

        user.refresh_from_db()
        self.assertTrue(user.profile.must_change_password)
        self.assertTrue(user.check_password(default_password))

        self.client.logout()
        login_response = self.post_json("/api/auth/login/", {"username": "resetbyadmin", "password": default_password})
        self.assertEqual(login_response.status_code, 200)
        self.assertTrue(login_response.json()["data"]["profile"]["must_change_password"])

        me_response = self.client.get("/api/me/")
        self.assertEqual(me_response.status_code, 200)
        blocked_response = self.client.get("/api/me/dashboard/")
        self.assertEqual(blocked_response.status_code, 403)
        self.assertEqual(blocked_response.json()["error"]["code"], "password_change_required")
        public_blocked_response = self.client.get("/api/projects/")
        self.assertEqual(public_blocked_response.status_code, 403)

        weak_response = self.post_json(
            "/api/auth/password/change-required/",
            {"password1": "123", "password2": "123"},
        )
        self.assertEqual(weak_response.status_code, 422)
        self.assertIn("password2", weak_response.json()["error"]["details"])

        unchanged_response = self.post_json(
            "/api/auth/password/change-required/",
            {"password1": default_password, "password2": default_password},
        )
        self.assertEqual(unchanged_response.status_code, 422)
        self.assertIn("password1", unchanged_response.json()["error"]["details"])

        change_response = self.post_json(
            "/api/auth/password/change-required/",
            {"password1": "NewStrongPass12345", "password2": "NewStrongPass12345"},
        )
        self.assertEqual(change_response.status_code, 200)
        self.assertTrue(change_response.json()["data"]["logged_out"])

        user.refresh_from_db()
        self.assertFalse(user.profile.must_change_password)
        dashboard_after_logout = self.client.get("/api/me/dashboard/")
        self.assertEqual(dashboard_after_logout.status_code, 401)
        default_login = self.post_json("/api/auth/login/", {"username": "resetbyadmin", "password": default_password})
        self.assertEqual(default_login.status_code, 400)
        new_login = self.post_json("/api/auth/login/", {"username": "resetbyadmin", "password": "NewStrongPass12345"})
        self.assertEqual(new_login.status_code, 200)
        dashboard_response = self.client.get("/api/me/dashboard/")
        self.assertEqual(dashboard_response.status_code, 200)

    @override_settings(OPENMEDAILAB_DEFAULT_PASSWORD="")
    def test_admin_reset_password_requires_configured_system_default_password(self):
        call_command(
            "ensure_platform_admin",
            username="platform_admin",
            email="admin@example.com",
            password="StrongPass12345",
        )
        user = User.objects.create_user(username="emptydefault", email="emptydefault@example.com", password="StrongPass12345")
        admin = User.objects.get(username="platform_admin")
        self.client.force_login(admin)

        response = self.post_json(f"/api/admin/users/{user.profile.uid}/reset-password/", {})

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "default_password_not_configured")
        self.assertEqual(response.json()["error"]["message"], "系统默认密码未配置。")

    @override_settings(OPENMEDAILAB_DEFAULT_PASSWORD="SystemDefaultPass12345")
    def test_platform_admin_cannot_reset_own_password(self):
        call_command(
            "ensure_platform_admin",
            username="platform_admin",
            email="admin@example.com",
            password="StrongPass12345",
        )
        admin = User.objects.get(username="platform_admin")
        self.client.force_login(admin)

        response = self.post_json(f"/api/admin/users/{admin.profile.uid}/reset-password/", {})

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "self_reset_forbidden")
        self.assertEqual(response.json()["error"]["message"], "管理员不能恢复自己的密码。")
        admin.refresh_from_db()
        self.assertFalse(admin.profile.must_change_password)

    def test_regular_user_cannot_reset_another_users_password(self):
        user = User.objects.create_user(username="targetuser", email="target@example.com", password="StrongPass12345")
        normal = User.objects.create_user(username="normalresetter", email="normalresetter@example.com", password="StrongPass12345")
        self.client.force_login(normal)

        response = self.post_json(f"/api/admin/users/{user.profile.uid}/reset-password/", {})

        self.assertEqual(response.status_code, 403)

    def test_register_rolls_back_when_credit_ledger_fails(self):
        with self.assertRaises(RuntimeError):
            with patch("accounts.services.CreditLedger.objects.create", side_effect=RuntimeError("ledger failed")):
                self.post_json(
                    "/api/auth/register/",
                    {
                        "username": "rollbackuser",
                        "email": "rollback@example.com",
                        "display_name": "Rollback User",
                        "role_type": "undergrad_or_below",
                        "password1": "StrongPass12345",
                        "password2": "StrongPass12345",
                    },
                )
        self.assertFalse(User.objects.filter(username="rollbackuser").exists())

    def test_register_rolls_back_when_uid_generation_fails(self):
        with self.assertRaises(RuntimeError):
            with patch("accounts.models.uid_for_user", side_effect=RuntimeError("uid failed")):
                self.post_json(
                    "/api/auth/register/",
                    {
                        "username": "uidrollback",
                        "email": "uidrollback@example.com",
                        "display_name": "UID Rollback",
                        "role_type": "undergrad_or_below",
                        "password1": "StrongPass12345",
                        "password2": "StrongPass12345",
                    },
                )
        self.assertFalse(User.objects.filter(username="uidrollback").exists())

    def test_repeated_register_request_does_not_duplicate_credit_ledger(self):
        payload = {
            "username": "singleledger",
            "email": "singleledger@example.com",
            "display_name": "Single Ledger",
            "role_type": "undergrad_or_below",
            "password1": "StrongPass12345",
            "password2": "StrongPass12345",
        }
        first_response = self.post_json("/api/auth/register/", payload)
        self.assertEqual(first_response.status_code, 201)
        self.client.logout()

        second_response = self.post_json("/api/auth/register/", payload)
        self.assertEqual(second_response.status_code, 422)
        self.assertIn("username", second_response.json()["error"]["details"])

        user = User.objects.get(username="singleledger")
        self.assertEqual(User.objects.filter(email__iexact="singleledger@example.com").count(), 1)
        self.assertEqual(
            CreditLedger.objects.filter(user=user, action_type=CreditLedger.ActionType.REGISTER_BONUS).count(),
            1,
        )

    def test_legacy_api_views_do_not_expose_register_implementation(self):
        spec = importlib.util.find_spec("api.views")
        if spec is None:
            return
        import api.views as legacy_views

        self.assertFalse(hasattr(legacy_views, "register"))

    def test_login_api(self):
        User.objects.create_user(username="loginuser", password="StrongPass12345")
        response = self.post_json("/api/auth/login/", {"username": "loginuser", "password": "StrongPass12345"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["username"], "loginuser")


class InteractionConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.theme = Theme.objects.create(name="并发验收", slug="concurrency-acceptance")
        self.project = Project.objects.create(
            topic_id=9901,
            title="并发测试课题",
            summary="并发测试",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )
        self.other_project = Project.objects.create(
            topic_id=9902,
            title="并发测试课题 B",
            summary="并发测试 B",
            theme=self.theme,
            stage=ProjectStage.OPEN_RECRUITING,
            is_public=True,
        )

    def _user(self, username, credits=200):
        user = User.objects.create_user(
            username=username,
            email=f"{username}@example.com",
            password="StrongPass12345",
        )
        user.profile.credit_balance = credits
        user.profile.save(update_fields=["credit_balance", "updated_at"])
        return user

    def _client_for(self, user):
        client = Client()
        client.raise_request_exception = False
        client.force_login(user)
        return client

    def _post_as(self, user, path, payload):
        client = self._client_for(user)
        return self._post_with_client(client, path, payload)

    def _patch_as(self, user, path, payload):
        client = self._client_for(user)
        return self._patch_with_client(client, path, payload)

    def _post_with_client(self, client, path, payload):
        response = client.post(path, data=json.dumps(payload), content_type="application/json")
        return self._response_tuple(response)

    def _patch_with_client(self, client, path, payload):
        response = client.patch(path, data=json.dumps(payload), content_type="application/json")
        return self._response_tuple(response)

    def _response_tuple(self, response):
        try:
            body = response.json()
        except ValueError:
            body = response.content.decode("utf-8", errors="replace")[:500]
        return response.status_code, body

    def _parallel(self, *callables):
        barrier = threading.Barrier(len(callables))
        results = [None] * len(callables)
        errors = [None] * len(callables)

        def runner(index, func):
            close_old_connections()
            try:
                barrier.wait(timeout=5)
                results[index] = func()
            except Exception as exc:  # pragma: no cover - surfaced by assertion below
                errors[index] = exc
            finally:
                close_old_connections()

        threads = [threading.Thread(target=runner, args=(index, func)) for index, func in enumerate(callables)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        for thread in threads:
            self.assertFalse(thread.is_alive(), "并发测试线程未能按时结束")
        for error in errors:
            if error is not None:
                raise error
        return results

    def _assert_no_server_errors(self, results):
        for status_code, body in results:
            self.assertLess(status_code, 500, body)
            self.assertNotIn("database is locked", json.dumps(body, ensure_ascii=False).lower())
            self.assertNotIn("integrityerror", json.dumps(body, ensure_ascii=False).lower())

    def test_concurrent_leader_claim_allows_only_one_active_claim(self):
        first = self._user("leader_claim_a")
        second = self._user("leader_claim_b")
        first_client = self._client_for(first)
        second_client = self._client_for(second)

        results = self._parallel(
            lambda: self._post_with_client(first_client, f"/api/projects/{self.project.pk}/claim/", {"claim_type": "leader", "message": "并发负责人 A"}),
            lambda: self._post_with_client(second_client, f"/api/projects/{self.project.pk}/claim/", {"claim_type": "leader", "message": "并发负责人 B"}),
        )

        self._assert_no_server_errors(results)
        statuses = [status for status, _ in results]
        self.assertEqual(statuses.count(201), 1, results)
        self.assertEqual(statuses.count(409), 1, results)
        active_count = ProjectClaimIntent.objects.filter(
            project=self.project,
            claim_type="leader",
            status__in=[InteractionStatus.PENDING, InteractionStatus.APPROVED],
        ).count()
        self.assertEqual(active_count, 1)

    def test_concurrent_paper_first_unit_claim_allows_only_one_active_claim(self):
        first = self._user("paper_claim_a")
        second = self._user("paper_claim_b")
        first_client = self._client_for(first)
        second_client = self._client_for(second)

        results = self._parallel(
            lambda: self._post_with_client(
                first_client,
                f"/api/projects/{self.project.pk}/claim/",
                {"claim_type": "paper_first_unit", "claimed_unit_name": "第一单位A", "message": "申请第一单位 A"},
            ),
            lambda: self._post_with_client(
                second_client,
                f"/api/projects/{self.project.pk}/claim/",
                {"claim_type": "paper_first_unit", "claimed_unit_name": "第一单位B", "message": "申请第一单位 B"},
            ),
        )

        self._assert_no_server_errors(results)
        statuses = [status for status, _ in results]
        self.assertEqual(statuses.count(201), 1, results)
        self.assertEqual(statuses.count(409), 1, results)
        active_count = ProjectClaimIntent.objects.filter(
            project=self.project,
            claim_type="paper_first_unit",
            status__in=[InteractionStatus.PENDING, InteractionStatus.APPROVED],
        ).count()
        self.assertEqual(active_count, 1)

    def test_concurrent_sponsor_resubmit_does_not_duplicate_active_intent(self):
        sponsor = self._user("sponsor_concurrent")
        first_client = self._client_for(sponsor)
        second_client = self._client_for(sponsor)

        results = self._parallel(
            lambda: self._post_with_client(first_client, f"/api/projects/{self.project.pk}/sponsor/", {"sponsor_type": "compute", "note": "第一次"}),
            lambda: self._post_with_client(second_client, f"/api/projects/{self.project.pk}/sponsor/", {"sponsor_type": "compute", "note": "第二次"}),
        )

        self._assert_no_server_errors(results)
        statuses = [status for status, _ in results]
        self.assertIn(201, statuses, results)
        self.assertTrue(set(statuses).issubset({200, 201}), results)
        self.assertEqual(
            SponsorIntent.objects.filter(user=sponsor, project=self.project, sponsor_type="compute").count(),
            1,
        )

    def test_stage_change_blocks_in_flight_interaction_submit(self):
        participant = self._user("stage_race_participant")
        call_command(
            "ensure_platform_admin",
            username="platform_admin",
            email="admin@example.com",
            password="StrongPass12345",
        )
        admin = User.objects.get(username="platform_admin")
        admin_client = self._client_for(admin)
        participant_client = self._client_for(participant)

        results = self._parallel(
            lambda: self._patch_with_client(admin_client, f"/api/admin/projects/{self.project.pk}/", {"stage": ProjectStage.ACTIVE}),
            lambda: self._post_with_client(
                participant_client,
                f"/api/projects/{self.project.pk}/interest/",
                {"role": "学生", "available_hours_per_week": 4, "message": "阶段并发参与"},
            ),
        )

        self._assert_no_server_errors(results)
        admin_status, _ = results[0]
        interaction_status, interaction_body = results[1]
        self.assertEqual(admin_status, 200, results)
        self.assertIn(interaction_status, {201, 422}, results)
        if interaction_status == 422:
            self.assertEqual(interaction_body["error"]["code"], "project_not_recruiting")
            self.assertFalse(ProjectInterest.objects.filter(user=participant, project=self.project).exists())
        else:
            self.assertTrue(
                ProjectInterest.objects.filter(
                    user=participant,
                    project=self.project,
                    status=InteractionStatus.APPROVED,
                ).exists()
            )

    def test_participation_credit_precheck_uses_locked_profile_balance(self):
        participant = self._user("credit_race_participant", credits=50)
        first_client = self._client_for(participant)
        second_client = self._client_for(participant)

        results = self._parallel(
            lambda: self._post_with_client(
                first_client,
                f"/api/projects/{self.project.pk}/interest/",
                {"role": "学生", "available_hours_per_week": 4, "message": "并发参与 A"},
            ),
            lambda: self._post_with_client(
                second_client,
                f"/api/projects/{self.other_project.pk}/interest/",
                {"role": "学生", "available_hours_per_week": 4, "message": "并发参与 B"},
            ),
        )

        self._assert_no_server_errors(results)
        statuses = [status for status, _ in results]
        self.assertLessEqual(statuses.count(201), 1, results)
        self.assertIn(422, statuses, results)
        for status_code, body in results:
            if status_code == 422:
                self.assertEqual(body["error"]["code"], "insufficient_credits")
        self.assertLessEqual(
            ProjectInterest.objects.filter(user=participant, status=InteractionStatus.APPROVED).count(),
            1,
        )
