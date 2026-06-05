from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class InteractionStatus(models.TextChoices):
    PENDING = "pending", "待处理"
    APPROVED = "approved", "已通过"
    REJECTED = "rejected", "已拒绝"
    RECORDED = "recorded", "已记录"
    WITHDRAWN = "withdrawn", "已撤回"


class ParticipationRole(models.TextChoices):
    DOCTOR = "医生", "医生"
    STUDENT = "学生", "学生"
    LEADER = "Leader", "Leader"
    AI_ENGINEER = "AI工程师", "AI 工程师"
    STATISTICIAN = "医学统计", "医学统计"
    LITERATURE = "文献整理", "文献整理"
    DATA = "数据处理", "数据处理"
    WRITING = "论文写作", "论文写作"
    SPONSOR = "资助者", "资助者"
    OTHER = "其他", "其他"


class ClaimType(models.TextChoices):
    LEADER = "leader", "认领项目负责人"
    EXPERIMENT = "experiment", "认领实验"
    LITERATURE = "literature", "认领文献整理"
    DATA = "data", "认领数据处理"
    MODEL = "model", "认领模型实现"
    WRITING = "writing", "认领论文写作"
    MEDICAL_REVIEW = "medical_review", "认领医学审核"


class SponsorType(models.TextChoices):
    FUNDING = "funding", "经费"
    CREDITS = "credits", "积分池"
    COMPUTE = "compute", "算力"
    DATA_BUDGET = "data_budget", "数据整理预算"
    LABEL_BUDGET = "label_budget", "标注预算"
    EXPERT = "expert", "专家咨询"
    STUDENT_LABOR = "student_labor", "学生劳务"
    PUBLICATION_FEE = "publication_fee", "论文版面费"
    OTHER = "other", "其他"


class ProjectFollow(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_follows")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="follows")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "project"], name="unique_project_follow"),
        ]
        indexes = [
            models.Index(fields=["project", "-created_at"]),
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.user} follows {self.project}"


class ProjectScore(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_scores")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="scores")
    score = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(10)])
    comment = models.TextField(blank=True)
    weight = models.DecimalField(max_digits=4, decimal_places=2, default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "project"], name="unique_project_score"),
        ]
        indexes = [
            models.Index(fields=["project", "-updated_at"]),
            models.Index(fields=["user", "-updated_at"]),
        ]

    def __str__(self):
        return f"{self.user} rated {self.project}: {self.score}"


class ProjectInterest(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_interests")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="interests")
    role = models.CharField(max_length=40, choices=ParticipationRole.choices)
    available_hours_per_week = models.PositiveSmallIntegerField(default=0)
    experience = models.TextField(blank=True)
    message = models.TextField(blank=True)
    status = models.CharField(max_length=32, choices=InteractionStatus.choices, default=InteractionStatus.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "project", "role"], name="unique_project_interest_role"),
        ]
        indexes = [
            models.Index(fields=["project", "role", "status"]),
            models.Index(fields=["user", "-updated_at"]),
        ]

    def __str__(self):
        return f"{self.user} interest {self.project} as {self.role}"


class ProjectClaimIntent(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_claim_intents")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="claim_intents")
    claim_type = models.CharField(max_length=40, choices=ClaimType.choices)
    message = models.TextField(blank=True)
    status = models.CharField(max_length=32, choices=InteractionStatus.choices, default=InteractionStatus.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "project", "claim_type"], name="unique_project_claim_intent"),
        ]
        indexes = [
            models.Index(fields=["project", "claim_type", "status"]),
            models.Index(fields=["user", "-updated_at"]),
        ]

    def __str__(self):
        return f"{self.user} claim {self.project}: {self.claim_type}"


class SponsorIntent(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sponsor_intents")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="sponsor_intents")
    sponsor_type = models.CharField(max_length=40, choices=SponsorType.choices)
    note = models.TextField(blank=True)
    status = models.CharField(max_length=32, choices=InteractionStatus.choices, default=InteractionStatus.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "project", "sponsor_type"], name="unique_sponsor_intent"),
        ]
        indexes = [
            models.Index(fields=["project", "sponsor_type", "status"]),
            models.Index(fields=["user", "-updated_at"]),
        ]

    def __str__(self):
        return f"{self.user} sponsor {self.project}: {self.sponsor_type}"

# Create your models here.
