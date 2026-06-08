import json
import importlib.util
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.management import call_command
from django.conf import settings
from django.test import Client, TestCase, override_settings

from credits.models import CreditLedger
from interactions.models import ProjectFollow, ProjectInterest, ProjectScore
from projects.models import Project, ProjectStage, Tag, Theme, ThemeFile


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
        self.assertIn("/api/admin/projects/{project_id}/", schema["paths"])

        docs_response = self.client.get("/api/docs")
        self.assertEqual(docs_response.status_code, 200)
        self.assertContains(docs_response, "OpenMedAILab API")

        contract_response = self.client.get("/api/project-schema/")
        self.assertEqual(contract_response.status_code, 200)
        contract_data = contract_response.json()["data"]
        contract_fields = [field["name"] for field in contract_data["fields"]]
        self.assertIn("problem_statement", contract_fields)
        self.assertIn("data_requirements", contract_fields)
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

    def test_admin_can_manage_theme_and_import_project_json(self):
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

        import_response = self.post_json(
            "/api/admin/projects/import-json/",
            {
                "projects": [
                    {
                        "topic_id": "RETINA-002",
                        "theme": "视网膜影像",
                        "title": "OCT 病灶分割评估",
                        "summary": "面向 OCT 病灶分割模型的临床可用性评估。",
                        "problem_statement": "需要验证分割结果是否可被医生复核。",
                        "data_requirements": {"modalities": ["OCT"], "minimum_cases": 30},
                        "expected_outputs": ["标注规范", "评估报告"],
                        "tags": ["OCT", "分割"],
                        "documents": [{"doc_type": "markdown", "title": "方案", "path": "topics/RETINA-002.md"}],
                    }
                ]
            },
        )
        self.assertEqual(import_response.status_code, 200)
        self.assertEqual(import_response.json()["data"]["created_count"], 1)
        project = Project.objects.get(topic_id="RETINA-002")
        self.assertEqual(project.data_requirements["modalities"], ["OCT"])
        self.assertEqual(project.documents.count(), 1)

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

    def test_regular_user_cannot_manage_content(self):
        user = User.objects.create_user(username="normaluser", password="StrongPass12345")
        self.client.force_login(user)

        response = self.post_json("/api/admin/themes/", {"name": "不应创建"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "permission_denied")

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
