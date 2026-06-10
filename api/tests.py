import json
import importlib.util
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.management import call_command
from django.conf import settings
from django.test import Client, TestCase, override_settings

from accounts.models import PLATFORM_ADMIN_UID
from credits.models import Contribution, ContributionStatus, CreditLedger
from interactions.models import InteractionStatus, ProjectClaimIntent, ProjectFollow, ProjectInterest, ProjectScore, SponsorIntent
from projects.models import AuditLog, Project, ProjectDocument, ProjectStage, ProjectTask, Tag, Theme, ThemeFile


class ApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.theme = Theme.objects.create(name="AntiVEGF", slug="antivegf")
        self.tag = Tag.objects.create(name="RAG", slug="rag")
        self.project = Project.objects.create(
            topic_id="AntiVEGF-001",
            title="纵向病例证据 RAG",
            summary="用于抗 VEGF 随访复核。",
            problem_statement="随访证据分散，难以复核。",
            research_goal="验证 RAG 对复核效率的帮助。",
            technical_route="证据切片 -> 检索 -> 医生审核。",
            data_requirements={"modalities": ["随访表", "OCT 摘要"]},
            evaluation_metrics=["一致性"],
            expected_outputs=["实验报告"],
            compliance_notes="只使用脱敏数据。",
            body_markdown="## 背景\n测试正文",
            theme=self.theme,
            project_no=1,
            stage=ProjectStage.OPEN_RECRUITING,
            llm_score=8.5,
            composite_score=8.5,
            needed_roles=["医生", "学生", "Leader"],
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
        list_response = self.client.get("/api/projects/?q=RAG&page_size=10")
        self.assertEqual(list_response.status_code, 200)
        list_payload = list_response.json()
        self.assertTrue(list_payload["ok"])
        self.assertEqual(list_payload["data"]["pagination"]["total_count"], 1)
        self.assertEqual(list_payload["data"]["results"][0]["topic_id"], "AntiVEGF-001")

        detail_response = self.client.get(f"/api/projects/{self.project.pk}/")
        self.assertEqual(detail_response.status_code, 200)
        detail_payload = detail_response.json()
        self.assertEqual(detail_payload["data"]["team_status"]["basic_ready"], False)
        self.assertEqual(detail_payload["data"]["body_markdown"], "## 背景\n测试正文")
        self.assertEqual(detail_payload["data"]["problem_statement"], "随访证据分散，难以复核。")
        self.assertEqual(detail_payload["data"]["data_requirements"]["modalities"], ["随访表", "OCT 摘要"])

    def test_lifecycle_stage_contract_and_public_filters(self):
        stage_values = [value for value, _ in ProjectStage.choices]
        self.assertEqual(
            stage_values,
            ["draft", "open_recruiting", "team_building", "active", "paused", "archived"],
        )

        draft = Project.objects.create(
            topic_id="AntiVEGF-DRAFT",
            title="草稿课题",
            theme=self.theme,
            stage=ProjectStage.DRAFT,
            is_public=True,
        )
        archived = Project.objects.create(
            topic_id="AntiVEGF-ARCHIVED",
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

        theme_space_response = self.client.get(f"/api/themes/{self.theme.slug}/space/")
        self.assertEqual(theme_space_response.status_code, 200)
        theme_space_ids = {item["topic_id"] for item in theme_space_response.json()["data"]["projects"]}
        self.assertIn(self.project.topic_id, theme_space_ids)
        self.assertNotIn(draft.topic_id, theme_space_ids)
        self.assertNotIn(archived.topic_id, theme_space_ids)

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
        self.assertNotIn("/api/admin/projects/import-json/", schema["paths"])
        self.assertIn("/api/admin/theme-files/", schema["paths"])
        self.assertIn("/api/admin/projects/{project_id}/", schema["paths"])
        self.assertIn("/api/projects/{project_id}/status-card/", schema["paths"])
        self.assertIn("/api/admin/overview/", schema["paths"])
        self.assertIn("/api/admin/interactions/", schema["paths"])
        self.assertIn("/api/admin/tasks/", schema["paths"])
        self.assertIn("/api/admin/contributions/{contribution_id}/review/", schema["paths"])
        self.assertIn("/api/admin/audit-logs/", schema["paths"])
        self.assertIn("/api/me/contributions/", schema["paths"])

        docs_response = self.client.get("/api/docs")
        self.assertEqual(docs_response.status_code, 200)
        self.assertContains(docs_response, "OpenMedAILab API")

        contract_response = self.client.get("/api/project-schema/")
        self.assertEqual(contract_response.status_code, 200)
        contract_data = contract_response.json()["data"]
        contract_fields = [field["name"] for field in contract_data["fields"]]
        self.assertIn("problem_statement", contract_fields)
        self.assertIn("data_requirements", contract_fields)
        self.assertIn("markdown_template", contract_data)
        self.assertIn("模板版本：v1", contract_data["markdown_template"])
        self.assertNotIn("example", contract_data)
        theme_file_types = [item["value"] for item in contract_data["theme_file_types"]]
        self.assertIn("dataset", theme_file_types)
        self.assertIn("data_dictionary", theme_file_types)
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

    def test_theme_file_space_api(self):
        self.theme.file_space = {"sections": ["数据集文件", "数据字典"]}
        self.theme.save(update_fields=["file_space", "updated_at"])
        ThemeFile.objects.create(
            theme=self.theme,
            section="数据集文件",
            file_type=ThemeFile.FileType.DATASET,
            title="抗 VEGF 脱敏随访样例索引",
            path="datasets/antivegf/followup-index.csv",
        )

        response = self.client.get(f"/api/themes/{self.theme.slug}/space/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["theme"]["file_space"]["sections"], ["数据集文件", "数据字典"])
        self.assertEqual(payload["project_count"], 1)
        self.assertEqual(payload["file_count"], 1)
        self.assertEqual(payload["sections"][0]["name"], "数据集文件")
        self.assertEqual(payload["sections"][0]["files"][0]["title"], "抗 VEGF 脱敏随访样例索引")
        self.assertNotIn("documents_by_type", payload)

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
                "file_space": {"sections": ["数据集文件", "标注规范"]},
            },
        )
        self.assertEqual(theme_response.status_code, 201)
        self.assertEqual(theme_response.json()["data"]["file_space"]["sections"], ["数据集文件", "标注规范"])

        create_response = self.post_json(
            "/api/admin/projects/",
            {
                "topic_id": "RETINA-002",
                "theme": "视网膜影像",
                "title": "OCT 病灶分割评估",
                "summary": "面向 OCT 病灶分割模型的临床可用性评估。",
                "problem_statement": "需要验证分割结果是否可被医生复核。",
                "data_requirements": {"modalities": ["OCT"], "minimum_cases": 30},
                "expected_outputs": ["标注规范", "评估报告"],
                "tags": ["OCT", "分割"],
                "source_md_path": "topics/RETINA-002.md",
                "documents": [{"doc_type": "markdown", "title": "方案", "path": "topics/RETINA-002.md"}],
            },
        )
        self.assertEqual(create_response.status_code, 201)
        project = Project.objects.get(topic_id="RETINA-002")
        self.assertEqual(project.data_requirements["modalities"], ["OCT"])
        self.assertEqual(project.documents.count(), 1)
        self.assertEqual(project.stage, ProjectStage.DRAFT)
        self.assertFalse(project.is_public)

        file_response = self.post_json(
            "/api/admin/theme-files/",
            {
                "theme_id": project.theme_id,
                "section": "数据说明",
                "file_type": "dataset_meta",
                "title": "脱敏数据说明",
                "path": "spaces/retina-imaging/data.json",
                "description": "主题级文件域记录",
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
        self.assertEqual(project_detail_response.json()["data"]["topic_id"], "RETINA-002")

        project_update_response = self.patch_json(f"/api/admin/projects/{project.pk}/", {"title": "OCT 病灶分割临床评估", "stage": "active"})
        self.assertEqual(project_update_response.status_code, 200)
        project.refresh_from_db()
        self.assertEqual(project.title, "OCT 病灶分割临床评估")
        self.assertEqual(project.stage, ProjectStage.ACTIVE)

        file_delete_response = self.client.delete(f"/api/admin/theme-files/{file_id}/")
        self.assertEqual(file_delete_response.status_code, 200)
        self.assertFalse(ThemeFile.objects.get(pk=file_id).is_active)

    def test_admin_project_create_update_boundaries(self):
        self.login_platform_admin()

        response = self.post_json(
            "/api/admin/projects/",
            {"topic_id": "NEW-001", "theme": self.theme.slug, "title": "新建课题", "stage": "active", "is_public": True},
        )
        self.assertEqual(response.status_code, 201)
        created = Project.objects.get(topic_id="NEW-001")
        self.assertEqual(created.stage, ProjectStage.DRAFT)
        self.assertFalse(created.is_public)
        self.assertEqual(response.json()["data"]["stage"], ProjectStage.DRAFT)
        self.assertFalse(response.json()["data"]["is_public"])
        self.assertFalse(Project.objects.filter(pk=created.pk, is_public=True).exists())

        duplicate_response = self.post_json(
            "/api/admin/projects/",
            {"topic_id": "NEW-001", "theme": self.theme.slug, "title": "重复课题"},
        )
        self.assertEqual(duplicate_response.status_code, 422)
        self.assertEqual(Project.objects.filter(topic_id="NEW-001").count(), 1)

        topic_change_response = self.patch_json(
            f"/api/admin/projects/{created.pk}/",
            {"topic_id": "NEW-002", "title": "不允许改编号"},
        )
        self.assertEqual(topic_change_response.status_code, 422)
        self.assertFalse(Project.objects.filter(topic_id="NEW-002").exists())

        unknown_theme_response = self.post_json(
            "/api/admin/projects/",
            {"topic_id": "NEW-003", "theme": "不存在主题", "title": "未知主题课题"},
        )
        self.assertEqual(unknown_theme_response.status_code, 422)
        self.assertFalse(Theme.objects.filter(name="不存在主题").exists())

    def test_admin_project_list_supports_duplicate_detection_fields(self):
        self.login_platform_admin()
        self.project.source_md_path = "topics/AntiVEGF-001.md"
        self.project.content_hash = "hash-for-duplicate-check"
        self.project.save(update_fields=["source_md_path", "content_hash", "updated_at"])

        topic_response = self.client.get("/api/admin/projects/?topic_id=AntiVEGF-001&page_size=10")
        self.assertEqual(topic_response.status_code, 200)
        topic_rows = topic_response.json()["data"]["results"]
        self.assertEqual(len(topic_rows), 1)
        self.assertEqual(topic_rows[0]["source_md_path"], "topics/AntiVEGF-001.md")
        self.assertEqual(topic_rows[0]["content_hash"], "hash-for-duplicate-check")

        source_response = self.client.get("/api/admin/projects/?source_md_path=topics/AntiVEGF-001.md&page_size=10")
        self.assertEqual(source_response.json()["data"]["pagination"]["total_count"], 1)

        hash_response = self.client.get("/api/admin/projects/?content_hash=hash-for-duplicate-check&page_size=10")
        self.assertEqual(hash_response.json()["data"]["pagination"]["total_count"], 1)

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
        self.project.source_md_path = "topics/AntiVEGF-001.md"
        self.project.source_pdf_path = "/Users/wang/private/AntiVEGF-001.pdf"
        self.project.page_path = "/internal/pages/AntiVEGF-001.html"
        self.project.content_hash = "internal-hash"
        self.project.source_payload = {"source": "api-admin", "payload": {"secret": "internal"}}
        self.project.save(update_fields=["source_md_path", "source_pdf_path", "page_path", "content_hash", "source_payload", "updated_at"])
        ProjectDocument.objects.create(
            project=self.project,
            doc_type=ProjectDocument.DocumentType.MARKDOWN,
            title="内部 Markdown",
            path="/Users/wang/private/topics/AntiVEGF-001.md",
            content_hash="document-internal-hash",
        )

        response = self.client.get(f"/api/projects/{self.project.pk}/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertNotIn("source_payload", payload)
        self.assertNotIn("content_hash", payload)
        self.assertNotIn("source_md_path", payload)
        self.assertNotIn("source_pdf_path", payload)
        self.assertNotIn("page_path", payload)
        self.assertNotIn("imported_at", payload)
        self.assertNotIn("/Users/wang/private", json.dumps(payload, ensure_ascii=False))
        self.assertNotIn("document-internal-hash", json.dumps(payload, ensure_ascii=False))

    def test_regular_user_cannot_manage_content(self):
        user = User.objects.create_user(username="normaluser", password="StrongPass12345")
        self.client.force_login(user)

        response = self.post_json("/api/admin/themes/", {"name": "不应创建"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "permission_denied")

    def test_project_status_card_exposes_uid_only_for_authenticated_viewer(self):
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
            ["收藏", "参与：学生（已通过）", "参与：医生（待处理）", "认领项目负责人（已通过）", "资助：算力（已通过）"],
        )
        uid_groups = {group["label"]: set(group["uids"]) for group in payload["uid_groups"]["groups"]}
        self.assertIn(student.profile.uid, uid_groups["收藏"])
        self.assertIn(student.profile.uid, uid_groups["参与：学生（已通过）"])
        self.assertIn(pending.profile.uid, uid_groups["参与：医生（待处理）"])
        self.assertIn(doctor.profile.uid, uid_groups["认领项目负责人（已通过）"])
        self.assertIn(student.profile.uid, uid_groups["资助：算力（已通过）"])
        self.assertNotIn("studentuid@example.com", json.dumps(payload, ensure_ascii=False))
        self.assertNotIn("studentuid", json.dumps(payload, ensure_ascii=False))

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

    def test_admin_reviews_interactions_and_writes_audit_log(self):
        applicant = User.objects.create_user(username="applicant", email="applicant@example.com", password="StrongPass12345")
        interest = ProjectInterest.objects.create(
            user=applicant,
            project=self.project,
            role="学生",
            available_hours_per_week=6,
            message="申请参与",
        )

        self.client.force_login(applicant)
        forbidden_response = self.client.get("/api/admin/interactions/")
        self.assertEqual(forbidden_response.status_code, 403)

        admin = self.login_platform_admin()
        list_response = self.client.get("/api/admin/interactions/?status=pending")
        self.assertEqual(list_response.status_code, 200)
        rows = list_response.json()["data"]["results"]
        self.assertEqual(rows[0]["type"], "interest")
        self.assertEqual(rows[0]["user"]["uid"], applicant.profile.uid)
        self.assertNotIn("applicant@example.com", json.dumps(rows[0], ensure_ascii=False))
        self.assertNotIn("applicant", json.dumps(rows[0], ensure_ascii=False))

        recorded_response = self.patch_json(
            f"/api/admin/interactions/interest/{interest.pk}/status/",
            {"status": "recorded", "review_note": "旧状态不再允许"},
        )
        self.assertEqual(recorded_response.status_code, 422)
        interest.refresh_from_db()
        self.assertEqual(interest.status, InteractionStatus.PENDING)
        self.project.refresh_from_db()
        self.assertEqual(self.project.stage, ProjectStage.OPEN_RECRUITING)

        review_response = self.patch_json(
            f"/api/admin/interactions/interest/{interest.pk}/status/",
            {"status": "approved", "review_note": "匹配学生协作角色"},
        )

        self.assertEqual(review_response.status_code, 200)
        interest.refresh_from_db()
        self.project.refresh_from_db()
        self.assertEqual(interest.status, InteractionStatus.APPROVED)
        self.assertEqual(self.project.stage, ProjectStage.TEAM_BUILDING)
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="interaction.review",
                target_type="ProjectInterest",
                target_id=str(interest.pk),
                after__review_note="匹配学生协作角色",
            ).exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(
                actor=admin,
                action="project.stage_auto_team_building",
                target_type="Project",
                target_id=str(self.project.pk),
                after__stage=ProjectStage.TEAM_BUILDING,
            ).exists()
        )
        rereview_response = self.patch_json(
            f"/api/admin/interactions/interest/{interest.pk}/status/",
            {"status": "rejected", "review_note": "已处理申请不应重审"},
        )
        self.assertEqual(rereview_response.status_code, 422)
        self.assertEqual(rereview_response.json()["error"]["code"], "interaction_not_pending")
        interest.refresh_from_db()
        self.assertEqual(interest.status, InteractionStatus.APPROVED)
        audit_response = self.client.get("/api/admin/audit-logs/?action=interaction.review")
        self.assertEqual(audit_response.status_code, 200)
        audit_entry = audit_response.json()["data"]["results"][0]
        self.assertEqual(audit_entry["action_label"], "审核协作意向")
        self.assertIn(applicant.profile.uid, audit_entry["summary"])
        self.assertIn("已通过", audit_entry["summary"])
        self.assertNotIn('{"id"', audit_entry["summary"])

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
                "description": "梳理主题文件域的数据字段。",
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
        self.assertEqual(ProjectTask.objects.get(pk=task_id).status, ProjectTask.TaskStatus.REVIEW)

        self.client.force_login(admin)
        review_response = self.patch_json(
            f"/api/admin/contributions/{contribution_id}/review/",
            {"status": "approved", "review_comment": "可进入主题文件域", "grant_reward": True},
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
                "role_type": "student",
            },
        )
        self.assertEqual(register_response.status_code, 201)
        register_payload = register_response.json()["data"]
        self.assertEqual(register_payload["profile"]["credit_balance"], 100)
        self.assertEqual(register_payload["profile"]["uid"], f"S{register_payload['id']:08d}")
        self.assertNotIn("email_verified", register_payload["profile"])
        self.assertNotIn("email_verified_at", register_payload["profile"])

        follow_response = self.post_json(f"/api/projects/{self.project.pk}/follow/", {})
        self.assertEqual(follow_response.status_code, 200)
        self.assertEqual(ProjectFollow.objects.count(), 1)

        score_response = self.post_json(f"/api/projects/{self.project.pk}/score/", {"score": 9, "comment": "值得做"})
        self.assertEqual(score_response.status_code, 200)
        self.assertEqual(ProjectScore.objects.get().score, 9)

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

    def test_register_validation_errors_include_field_details(self):
        User.objects.create_user(username="existing", email="taken@example.com", password="StrongPass12345")

        duplicate_username = self.post_json(
            "/api/auth/register/",
            {
                "username": "existing",
                "email": "fresh@example.com",
                "display_name": "Duplicate",
                "role_type": "student",
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
                "role_type": "student",
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
                "role_type": "student",
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
                "role_type": "student",
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
                "role_type": "student",
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
                "role_type": "student",
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
            "student": "S",
            "doctor": "D",
            "teacher": "T",
            "ai_engineer": "E",
            "statistician": "M",
            "sponsor": "F",
            "other": "U",
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

        user = User.objects.get(username="studentuser")
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
                        "role_type": "student",
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
                        "role_type": "student",
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
            "role_type": "student",
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
