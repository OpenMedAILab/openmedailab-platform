from django.conf import settings
from django.db import models


class ProjectStage(models.TextChoices):
    DRAFT = "draft", "草稿"
    OPEN_RECRUITING = "open_recruiting", "开放招募"
    TEAM_BUILDING = "team_building", "组队中"
    ACTIVE = "active", "进行中"
    EXPERIMENTING = "experimenting", "实验中"
    WRITING = "writing", "写作中"
    SUBMITTED = "submitted", "投稿中"
    PUBLISHED = "published", "已发表"
    PAUSED = "paused", "暂停"
    ARCHIVED = "archived", "归档"


class Theme(models.Model):
    name = models.CharField(max_length=120, unique=True)
    slug = models.SlugField(max_length=140, unique=True, allow_unicode=True)
    description = models.TextField(blank=True)
    cover_image = models.CharField(max_length=255, blank=True)
    file_space = models.JSONField(default=dict, blank=True)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class Tag(models.Model):
    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(max_length=100, unique=True, allow_unicode=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Project(models.Model):
    topic_id = models.CharField(max_length=80, unique=True)
    title = models.CharField(max_length=255)
    summary = models.TextField(blank=True)
    problem_statement = models.TextField(blank=True)
    research_goal = models.TextField(blank=True)
    technical_route = models.TextField(blank=True)
    data_requirements = models.JSONField(default=dict, blank=True)
    evaluation_metrics = models.JSONField(default=list, blank=True)
    expected_outputs = models.JSONField(default=list, blank=True)
    compliance_notes = models.TextField(blank=True)
    body_markdown = models.TextField(blank=True)
    theme = models.ForeignKey(Theme, on_delete=models.SET_NULL, null=True, blank=True, related_name="projects")
    project_no = models.PositiveIntegerField(null=True, blank=True)
    stage = models.CharField(max_length=32, choices=ProjectStage.choices, default=ProjectStage.OPEN_RECRUITING)
    source_md_path = models.CharField(max_length=500, blank=True, db_index=True)
    source_pdf_path = models.CharField(max_length=500, blank=True)
    page_path = models.CharField(max_length=500, blank=True)
    content_hash = models.CharField(max_length=64, blank=True)
    llm_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    community_score = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    composite_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    recommended_journal = models.CharField(max_length=160, blank=True)
    needed_roles = models.JSONField(default=list, blank=True)
    score_dimensions = models.JSONField(default=dict, blank=True)
    source_payload = models.JSONField(default=dict, blank=True)
    has_pdf = models.BooleanField(default=False)
    is_public = models.BooleanField(default=True)
    imported_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    tags = models.ManyToManyField(Tag, through="ProjectTag", related_name="projects", blank=True)

    class Meta:
        ordering = ["-composite_score", "-llm_score", "topic_id"]
        indexes = [
            models.Index(fields=["stage", "is_public"]),
            models.Index(fields=["theme", "stage"]),
            models.Index(fields=["has_pdf"]),
            models.Index(fields=["-composite_score"]),
            models.Index(fields=["-community_score"]),
            models.Index(fields=["-updated_at"]),
        ]

    def __str__(self):
        return self.title

    @property
    def team_status(self):
        role_counts = {role: 0 for role in ["医生", "学生", "Leader", "AI工程师", "医学统计"]}
        for item in self.interests.exclude(status="withdrawn").values("role").annotate(count=models.Count("id")):
            role_counts[item["role"]] = item["count"]
        sponsor_count = self.sponsor_intents.exclude(status="withdrawn").count()
        return {
            "roles": role_counts,
            "sponsor_count": sponsor_count,
            "basic_ready": role_counts["医生"] >= 1 and role_counts["学生"] >= 1 and role_counts["Leader"] >= 1,
        }


class ProjectTag(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    tag = models.ForeignKey(Tag, on_delete=models.CASCADE)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project", "tag"], name="unique_project_tag"),
        ]

    def __str__(self):
        return f"{self.project_id}:{self.tag.name}"


class ProjectDocument(models.Model):
    class DocumentType(models.TextChoices):
        MARKDOWN = "markdown", "Markdown"
        PDF = "pdf", "PDF"
        HTML = "html", "HTML"
        OTHER = "other", "其他"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="documents")
    doc_type = models.CharField(max_length=20, choices=DocumentType.choices)
    title = models.CharField(max_length=255, blank=True)
    path = models.CharField(max_length=500)
    content_hash = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project", "doc_type", "path"], name="unique_project_document"),
        ]
        indexes = [models.Index(fields=["doc_type"])]

    def __str__(self):
        return self.title or self.path


class ThemeFile(models.Model):
    class FileType(models.TextChoices):
        DATASET = "dataset", "数据集文件"
        DATA_DICTIONARY = "data_dictionary", "数据字典"
        ANNOTATION_GUIDE = "annotation_guide", "标注规范"
        ETHICS = "ethics", "伦理合规材料"
        MODEL_ARTIFACT = "model_artifact", "模型与实验资产"
        DATASET_META = "dataset_meta", "数据说明"
        LINK = "link", "外部链接"
        OTHER = "other", "其他"

    theme = models.ForeignKey(Theme, on_delete=models.CASCADE, related_name="files")
    section = models.CharField(max_length=80, default="数据集文件")
    file_type = models.CharField(max_length=30, choices=FileType.choices, default=FileType.OTHER)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    path = models.CharField(max_length=500)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["theme__sort_order", "theme__name", "sort_order", "section", "title"]
        constraints = [
            models.UniqueConstraint(fields=["theme", "path"], name="unique_theme_file_path"),
        ]
        indexes = [
            models.Index(fields=["theme", "section"]),
            models.Index(fields=["file_type"]),
            models.Index(fields=["is_active"]),
        ]

    def __str__(self):
        return f"{self.theme.name}: {self.title}"


class ProjectTask(models.Model):
    class TaskStatus(models.TextChoices):
        TODO = "todo", "待认领"
        CLAIMED = "claimed", "已认领"
        IN_PROGRESS = "in_progress", "进行中"
        REVIEW = "review", "待审核"
        DONE = "done", "已完成"
        CANCELLED = "cancelled", "已取消"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=180)
    description = models.TextField(blank=True)
    task_type = models.CharField(max_length=80, blank=True)
    required_role = models.CharField(max_length=80, blank=True)
    difficulty = models.PositiveSmallIntegerField(default=1)
    status = models.CharField(max_length=32, choices=TaskStatus.choices, default=TaskStatus.TODO)
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_tasks")
    deadline = models.DateField(null=True, blank=True)
    credit_deposit = models.IntegerField(default=0)
    credit_reward = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["project", "status"]),
            models.Index(fields=["assignee", "status"]),
        ]

    def __str__(self):
        return self.title


class ImportLog(models.Model):
    source_file = models.CharField(max_length=500)
    total_count = models.PositiveIntegerField(default=0)
    created_count = models.PositiveIntegerField(default=0)
    updated_count = models.PositiveIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)
    message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.source_file} ({self.created_count}/{self.updated_count}/{self.failed_count})"


class AuditLog(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=120)
    target_type = models.CharField(max_length=120, blank=True)
    target_id = models.CharField(max_length=120, blank=True)
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["action"]),
            models.Index(fields=["target_type", "target_id"]),
        ]

    def __str__(self):
        return f"{self.action} {self.target_type}:{self.target_id}"

# Create your models here.
