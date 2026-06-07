import json

from django.contrib.auth.models import User
from django.test import Client, TestCase

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
        admin = User.objects.create_user(username="adminuser", password="StrongPass12345", is_staff=True)
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
        self.assertEqual(register_response.json()["data"]["profile"]["credit_balance"], 100)

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

    def test_login_api(self):
        User.objects.create_user(username="loginuser", password="StrongPass12345")
        response = self.post_json("/api/auth/login/", {"username": "loginuser", "password": "StrongPass12345"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["username"], "loginuser")
