from django.contrib import admin

from .models import UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "display_name", "role_type", "organization", "credit_balance", "reputation_score", "updated_at")
    list_filter = ("role_type",)
    search_fields = ("user__username", "display_name", "real_name", "organization", "skills", "research_interests")
    readonly_fields = ("created_at", "updated_at")

# Register your models here.
