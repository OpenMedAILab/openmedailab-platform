from django.conf import settings
from django.contrib.auth.models import User
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver


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
    display_name = models.CharField(max_length=80, blank=True)
    real_name = models.CharField(max_length=80, blank=True)
    role_type = models.CharField(max_length=32, choices=RoleType.choices, default=RoleType.OTHER)
    organization = models.CharField(max_length=160, blank=True)
    title = models.CharField(max_length=120, blank=True)
    research_interests = models.TextField(blank=True)
    skills = models.TextField(blank=True)
    available_hours_per_week = models.PositiveSmallIntegerField(default=0)
    contact_email = models.EmailField(blank=True)
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
        UserProfile.objects.create(
            user=instance,
            display_name=instance.username,
            contact_email=instance.email,
            credit_balance=getattr(settings, "OPENMEDAILAB_INITIAL_CREDITS", 100),
        )

# Create your models here.
