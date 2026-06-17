from django.conf import settings
from django.db import models
from django.utils import timezone


class ProjectStage(models.TextChoices):
    DRAFT = "draft", "草稿"
    OPEN_RECRUITING = "open_recruiting", "开放招募"
    TEAM_BUILDING = "team_building", "组队中"
    ACTIVE = "active", "进行中"
    PAUSED = "paused", "暂停"
    ARCHIVED = "archived", "归档"


PUBLIC_PROJECT_STAGES = [
    ProjectStage.OPEN_RECRUITING,
    ProjectStage.TEAM_BUILDING,
    ProjectStage.ACTIVE,
    ProjectStage.PAUSED,
]

FOLLOWABLE_PROJECT_STAGES = [
    ProjectStage.OPEN_RECRUITING,
    ProjectStage.TEAM_BUILDING,
    ProjectStage.ACTIVE,
]

RECRUITING_PROJECT_STAGES = [
    ProjectStage.OPEN_RECRUITING,
    ProjectStage.TEAM_BUILDING,
]


class Theme(models.Model):
    name = models.CharField(max_length=120, unique=True)
    slug = models.SlugField(max_length=140, unique=True, allow_unicode=True)
    description = models.TextField(blank=True)
    cover_image = models.CharField(max_length=255, blank=True)
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
    topic_id = models.PositiveIntegerField(unique=True)
    title = models.CharField(max_length=255)
    title_en = models.CharField(max_length=255, blank=True)
    summary = models.TextField(blank=True)
    problem_statement = models.TextField(blank=True)
    clinical_endpoint = models.CharField(max_length=250, blank=True)
    existing_foundation = models.CharField(max_length=250, blank=True)
    team_requirements = models.TextField(blank=True)
    project_progress = models.TextField(blank=True)
    target_venue = models.CharField(max_length=255, blank=True)
    theme = models.ForeignKey(Theme, on_delete=models.SET_NULL, null=True, blank=True, related_name="projects")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="uploaded_projects")
    stage = models.CharField(max_length=32, choices=ProjectStage.choices, default=ProjectStage.DRAFT)
    source_payload = models.JSONField(default=dict, blank=True)
    is_public = models.BooleanField(default=False)
    imported_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    tags = models.ManyToManyField(Tag, through="ProjectTag", related_name="projects", blank=True)

    class Meta:
        ordering = ["topic_id"]
        indexes = [
            models.Index(fields=["stage", "is_public"]),
            models.Index(fields=["theme", "stage"]),
            models.Index(fields=["created_by", "-created_at"]),
            models.Index(fields=["-updated_at"]),
        ]
    def __str__(self):
        return self.title

    @property
    def topic_code(self):
        return f"T{self.topic_id:04d}"

    @property
    def team_status(self):
        from accounts.models import PUBLIC_ROLE_CHOICES, RoleType, normalize_public_role

        role_counts = {role: 0 for role in ["医生", "学生", "Leader", "大学老师", "AI工程师", "工程师", "医学统计"]}
        for item in self.interests.filter(status="approved").values("role").annotate(count=models.Count("id")):
            role_counts[item["role"]] = item["count"]
        profile_group_counts = {value: 0 for value, _ in PUBLIC_ROLE_CHOICES}
        approved_interests = self.interests.filter(status="approved").select_related("user__profile")
        for interest in approved_interests:
            profile = getattr(interest.user, "profile", None)
            role_type = normalize_public_role(getattr(profile, "role_type", ""))
            if not role_type:
                role_type = {
                    "医生": RoleType.DOCTOR,
                    "学生": RoleType.UNDERGRAD_OR_BELOW,
                    "大学老师": RoleType.PHD_OR_ABOVE,
                    "AI工程师": RoleType.ENGINEER,
                    "工程师": RoleType.ENGINEER,
                }.get(interest.role, "")
            if role_type in profile_group_counts:
                profile_group_counts[role_type] += 1
        role_group_counts = [
            {"role_type": value, "label": label, "count": profile_group_counts[value]}
            for value, label in PUBLIC_ROLE_CHOICES
        ]
        sponsor_count = self.sponsor_intents.filter(status="approved").count()
        leader_count = self.claim_intents.filter(status="approved", claim_type="leader").count() + role_counts.get("Leader", 0)
        student_profile_count = (
            profile_group_counts.get(RoleType.UNDERGRAD_OR_BELOW, 0)
            + profile_group_counts.get(RoleType.MASTER_STUDENT, 0)
            + profile_group_counts.get(RoleType.PHD_STUDENT, 0)
        )
        student_count = max(student_profile_count, role_counts.get("学生", 0))
        doctor_count = max(profile_group_counts.get(RoleType.DOCTOR, 0), role_counts.get("医生", 0))
        mentor_count = max(profile_group_counts.get(RoleType.PHD_OR_ABOVE, 0), role_counts.get("大学老师", 0))
        def required_role(key, label, count, required=1):
            overfilled = count > required
            ready = count >= required
            status = "overfilled" if overfilled else "ready" if ready else "missing"
            return {
                "key": key,
                "label": label,
                "count": count,
                "required": required,
                "ready": ready,
                "overfilled": overfilled,
                "status": status,
            }

        return {
            "roles": role_counts,
            "role_groups": role_group_counts,
            "visible_role_groups": [item for item in role_group_counts if item["count"] > 0],
            "required_roles": [
                required_role("doctor", "医生（医学指导）", doctor_count),
                required_role("student", "学生（实验）", student_count),
                required_role("mentor", "博士毕业及以上（指导）", mentor_count),
                required_role("leader", "Leader（项目负责人）", leader_count),
            ],
            "leader_count": leader_count,
            "sponsor_count": sponsor_count,
            "basic_ready": doctor_count >= 1 and student_count >= 1 and mentor_count >= 1 and leader_count >= 1,
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
    class Visibility(models.TextChoices):
        PUBLIC = "public", "公开"
        OWNER_ADMIN = "owner_admin", "课题所有者和管理员"

    class DocumentType(models.TextChoices):
        MARKDOWN = "markdown", "Markdown"
        PDF = "pdf", "PDF"
        HTML = "html", "HTML"
        OTHER = "other", "其他"

    class DocumentKind(models.TextChoices):
        DETAIL = "detail", "课题主PDF"
        SUPPLEMENT = "supplement", "补充说明"
        PROGRESS = "progress", "项目进度文档"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="documents")
    doc_type = models.CharField(max_length=20, choices=DocumentType.choices)
    document_kind = models.CharField(max_length=32, choices=DocumentKind.choices, default=DocumentKind.SUPPLEMENT)
    title = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    path = models.CharField(max_length=500)
    content_hash = models.CharField(max_length=64, blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="uploaded_project_documents")
    visibility = models.CharField(max_length=32, choices=Visibility.choices, default=Visibility.PUBLIC)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project", "doc_type", "path"], name="unique_project_document"),
        ]
        indexes = [models.Index(fields=["doc_type"])]

    def __str__(self):
        return self.title or self.path


class ProjectProgressEntry(models.Model):
    class EntryType(models.TextChoices):
        STAGE = "stage", "阶段变化"
        DOCUMENT = "document", "文档"
        NOTE = "note", "说明"

    class Visibility(models.TextChoices):
        PUBLIC = "public", "公开"
        OWNER_ADMIN = "owner_admin", "课题所有者和管理员"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="progress_entries")
    entry_type = models.CharField(max_length=32, choices=EntryType.choices, default=EntryType.NOTE)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    occurred_at = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="project_progress_entries")
    document = models.ForeignKey(ProjectDocument, on_delete=models.SET_NULL, null=True, blank=True, related_name="progress_entries")
    visibility = models.CharField(max_length=32, choices=Visibility.choices, default=Visibility.PUBLIC)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-occurred_at", "-id"]
        indexes = [
            models.Index(fields=["project", "-occurred_at"]),
            models.Index(fields=["entry_type"]),
            models.Index(fields=["visibility"]),
        ]

    def __str__(self):
        return self.title


class ProjectDiscussion(models.Model):
    class Status(models.TextChoices):
        VISIBLE = "visible", "可见"
        HIDDEN = "hidden", "已隐藏"
        DELETED = "deleted", "已删除"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="discussions")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="project_discussions")
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True, related_name="replies")
    content = models.TextField()
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.VISIBLE)
    moderation_reason = models.TextField(blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="deleted_project_discussions")
    hidden_at = models.DateTimeField(null=True, blank=True)
    hidden_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="hidden_project_discussions")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["project", "status", "-created_at"]),
            models.Index(fields=["parent", "status", "created_at"]),
            models.Index(fields=["author", "status"]),
        ]

    def __str__(self):
        return f"{self.project_id}:{self.author_id}:{self.status}"


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
    detail_pdf_title = models.CharField(max_length=255, blank=True)
    detail_pdf_path = models.CharField(max_length=500, blank=True)
    detail_pdf_hash = models.CharField(max_length=64, blank=True)
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
    request_id = models.CharField(max_length=64, blank=True)
    source = models.CharField(max_length=80, blank=True, default="api")
    status = models.CharField(max_length=32, blank=True, default="success")
    error_code = models.CharField(max_length=120, blank=True)
    error_message = models.TextField(blank=True)
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["action"]),
            models.Index(fields=["target_type", "target_id"]),
            models.Index(fields=["request_id"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"{self.action} {self.target_type}:{self.target_id}"

# Create your models here.
