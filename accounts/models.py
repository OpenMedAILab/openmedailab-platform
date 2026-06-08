from django.conf import settings
from django.contrib.auth.models import User
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver


PLATFORM_ADMIN_UID = "ADM00000001"


ROLE_UID_PREFIXES = {
    "student": "S",
    "doctor": "D",
    "teacher": "T",
    "ai_engineer": "E",
    "statistician": "M",
    "sponsor": "F",
    "other": "U",
}


def platform_admin_username():
    return getattr(settings, "OPENMEDAILAB_PLATFORM_ADMIN_USERNAME", "platform_admin")


def normalize_email(email):
    return (email or "").strip().lower()


def is_platform_admin_user(user):
    return bool(
        user
        and user.is_staff
        and user.is_superuser
        and user.username == platform_admin_username()
    )


def uid_for_user(user, role_type=None):
    if is_platform_admin_user(user):
        return PLATFORM_ADMIN_UID
    prefix = ROLE_UID_PREFIXES.get(role_type or RoleType.OTHER, ROLE_UID_PREFIXES[RoleType.OTHER])
    return f"{prefix}{user.id:08d}"


class RoleType(models.TextChoices):
    DOCTOR = "doctor", "医生"
    STUDENT = "student", "学生"
    TEACHER = "teacher", "老师"
    AI_ENGINEER = "ai_engineer", "AI 工程师"
    STATISTICIAN = "statistician", "医学统计"
    SPONSOR = "sponsor", "资助者"
    OTHER = "other", "其他"


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    uid = models.CharField(max_length=16, unique=True, null=True, blank=True, db_index=True)
    display_name = models.CharField(max_length=80, blank=True)
    real_name = models.CharField(max_length=80, blank=True)
    role_type = models.CharField(max_length=32, choices=RoleType.choices, default=RoleType.OTHER)
    organization = models.CharField(max_length=160, blank=True)
    title = models.CharField(max_length=120, blank=True)
    research_interests = models.TextField(blank=True)
    skills = models.TextField(blank=True)
    available_hours_per_week = models.PositiveSmallIntegerField(default=0)
    contact_email = models.EmailField(blank=True)
    email_normalized = models.EmailField(unique=True, null=True, blank=True, db_index=True)
    must_change_password = models.BooleanField(default=False)
    contact_wechat = models.CharField(max_length=80, blank=True)
    bio = models.TextField(blank=True)
    credit_balance = models.IntegerField(default=100)
    reputation_score = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["role_type"]),
            models.Index(fields=["credit_balance"]),
        ]

    def __str__(self):
        return self.display_name or self.user.username


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        role_type = getattr(instance, "_openmedailab_initial_role_type", RoleType.OTHER)
        display_name = getattr(instance, "_openmedailab_display_name", "") or instance.username
        email_normalized = normalize_email(instance.email)
        UserProfile.objects.create(
            user=instance,
            uid=uid_for_user(instance, role_type),
            display_name=display_name,
            role_type=role_type,
            contact_email=instance.email,
            email_normalized=email_normalized or None,
            credit_balance=getattr(settings, "OPENMEDAILAB_INITIAL_CREDITS", 100),
        )
