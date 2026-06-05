from django.contrib import admin

from .models import ProjectClaimIntent, ProjectFollow, ProjectInterest, ProjectScore, SponsorIntent


@admin.register(ProjectFollow)
class ProjectFollowAdmin(admin.ModelAdmin):
    list_display = ("user", "project", "created_at")
    list_filter = ("created_at", "project__theme")
    search_fields = ("user__username", "project__title", "project__topic_id")
    autocomplete_fields = ("user", "project")
    readonly_fields = ("created_at",)


@admin.register(ProjectScore)
class ProjectScoreAdmin(admin.ModelAdmin):
    list_display = ("user", "project", "score", "weight", "updated_at")
    list_filter = ("score", "project__theme", "updated_at")
    search_fields = ("user__username", "project__title", "project__topic_id", "comment")
    autocomplete_fields = ("user", "project")
    readonly_fields = ("created_at", "updated_at")


@admin.register(ProjectInterest)
class ProjectInterestAdmin(admin.ModelAdmin):
    list_display = ("user", "project", "role", "available_hours_per_week", "status", "updated_at")
    list_filter = ("role", "status", "project__theme", "updated_at")
    search_fields = ("user__username", "project__title", "project__topic_id", "experience", "message")
    autocomplete_fields = ("user", "project")
    readonly_fields = ("created_at", "updated_at")


@admin.register(ProjectClaimIntent)
class ProjectClaimIntentAdmin(admin.ModelAdmin):
    list_display = ("user", "project", "claim_type", "status", "updated_at")
    list_filter = ("claim_type", "status", "project__theme", "updated_at")
    search_fields = ("user__username", "project__title", "project__topic_id", "message")
    autocomplete_fields = ("user", "project")
    readonly_fields = ("created_at", "updated_at")


@admin.register(SponsorIntent)
class SponsorIntentAdmin(admin.ModelAdmin):
    list_display = ("user", "project", "sponsor_type", "status", "updated_at")
    list_filter = ("sponsor_type", "status", "project__theme", "updated_at")
    search_fields = ("user__username", "project__title", "project__topic_id", "note")
    autocomplete_fields = ("user", "project")
    readonly_fields = ("created_at", "updated_at")

# Register your models here.
