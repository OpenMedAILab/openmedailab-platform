from django.test import TestCase, override_settings

from projects.models import Project, ProjectStage, Theme
from projects.templatetags.markdown_extras import readable_markdown


@override_settings(
    STORAGES={
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
)
class ProjectPageTests(TestCase):
    def setUp(self):
        self.theme = Theme.objects.create(name="AntiVEGF", slug="antivegf")
        for index in range(25):
            Project.objects.create(
                topic_id=f"AntiVEGF-{index:03d}",
                title=f"RAG 安全评测课题 {index}",
                summary="用于测试课题列表分页和筛选参数保留。",
                theme=self.theme,
                stage=ProjectStage.OPEN_RECRUITING,
                llm_score=80 - index,
                composite_score=80 - index,
                is_public=True,
            )

    def test_project_list_pagination_keeps_filters(self):
        response = self.client.get(
            "/projects/",
            {"q": "RAG", "theme": "antivegf", "sort": "llm_score"},
        )

        self.assertContains(response, "q=RAG&amp;theme=antivegf&amp;sort=llm_score&amp;page=2")
        self.assertContains(response, "共 25 个匹配课题")

    def test_readable_markdown_formats_and_escapes_content(self):
        html = readable_markdown("# 标题\n\n**重点**\n\n- 条目\n\n<script>alert(1)</script>")

        self.assertIn("<h1>标题</h1>", html)
        self.assertIn("<strong>重点</strong>", html)
        self.assertIn("<li>条目</li>", html)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)
        self.assertNotIn("<script>", html)
