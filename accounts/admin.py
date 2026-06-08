from django.contrib import admin

from .models import UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("uid", "user", "display_name", "role_type", "organization", "must_change_password", "credit_balance", "reputation_score", "updated_at")
    list_filter = ("role_type", "must_change_password")
    search_fields = ("uid", "user__username", "user__email", "email_normalized", "display_name", "real_name", "organization", "skills", "research_interests")
    readonly_fields = ("created_at", "updated_at")

# Register your models here.
