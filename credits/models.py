from django.conf import settings
from django.db import models


class ContributionStatus(models.TextChoices):
    SUBMITTED = "submitted", "已提交"
    APPROVED = "approved", "已通过"
    REJECTED = "rejected", "已拒绝"
    NEEDS_REVISION = "needs_revision", "需修改"


class Contribution(models.Model):
    class ResultType(models.TextChoices):
        STAGE = "stage", "阶段性成果"
        FINAL = "final", "最终结果"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="contributions")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="contributions")
    task = models.ForeignKey("projects.ProjectTask", on_delete=models.SET_NULL, null=True, blank=True, related_name="contributions")
    title = models.CharField(max_length=180)
    description = models.TextField(blank=True)
    file_path = models.CharField(max_length=500, blank=True)
    result_type = models.CharField(max_length=16, choices=ResultType.choices, default=ResultType.STAGE)
    status = models.CharField(max_length=32, choices=ContributionStatus.choices, default=ContributionStatus.SUBMITTED)
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="reviewed_contributions")
    review_comment = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["project", "status"]),
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self):
        return self.title


class CreditLedger(models.Model):
    class ActionType(models.TextChoices):
        REGISTER_BONUS = "register_bonus", "注册奖励"
        TASK_DEPOSIT = "task_deposit", "任务承诺"
        TASK_REWARD = "task_reward", "任务奖励"
        SPONSOR_POOL = "sponsor_pool", "项目资助池"
        ADMIN_ADJUST = "admin_adjust", "管理员调整"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="credit_ledger")
    project = models.ForeignKey("projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="credit_ledger")
    task = models.ForeignKey("projects.ProjectTask", on_delete=models.SET_NULL, null=True, blank=True, related_name="credit_ledger")
    action_type = models.CharField(max_length=40, choices=ActionType.choices)
    amount = models.IntegerField()
    balance_after = models.IntegerField()
    reason = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_credit_entries")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["action_type"]),
        ]

    def __str__(self):
        return f"{self.user} {self.action_type} {self.amount}"

# Create your models here.
