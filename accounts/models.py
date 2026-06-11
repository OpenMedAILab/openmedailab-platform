from django.conf import settings
from django.contrib.auth.models import User
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver


PLATFORM_ADMIN_UID = "ADM00000001"


ROLE_UID_PREFIXES = {
    "doctor": "D",
    "undergrad_or_below": "U",
    "master_student": "M",
    "phd_student": "P",
    "phd_or_above": "R",
    "engineer": "E",
    "student": "S",
    "teacher": "R",
    "ai_engineer": "E",
    "statistician": "E",
    "sponsor": "U",
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
    UNDERGRAD_OR_BELOW = "undergrad_or_below", "在读本科及以下"
    MASTER_STUDENT = "master_student", "在读硕士"
    PHD_STUDENT = "phd_student", "在读博士"
    PHD_OR_ABOVE = "phd_or_above", "博士毕业及以上"
    ENGINEER = "engineer", "工程师"
    OTHER = "other", "其他"


PUBLIC_ROLE_CHOICES = [
    (RoleType.DOCTOR, RoleType.DOCTOR.label),
    (RoleType.UNDERGRAD_OR_BELOW, RoleType.UNDERGRAD_OR_BELOW.label),
    (RoleType.MASTER_STUDENT, RoleType.MASTER_STUDENT.label),
    (RoleType.PHD_STUDENT, RoleType.PHD_STUDENT.label),
    (RoleType.PHD_OR_ABOVE, RoleType.PHD_OR_ABOVE.label),
    (RoleType.ENGINEER, RoleType.ENGINEER.label),
]


LEGACY_ROLE_ALIASES = {
    "student": RoleType.UNDERGRAD_OR_BELOW,
    "teacher": RoleType.PHD_OR_ABOVE,
    "ai_engineer": RoleType.ENGINEER,
    "statistician": RoleType.ENGINEER,
}


def normalize_public_role(role_type):
    value = str(role_type or "").strip()
    public_values = {choice[0] for choice in PUBLIC_ROLE_CHOICES}
    if value in public_values:
        return value
    return LEGACY_ROLE_ALIASES.get(value, "")


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
