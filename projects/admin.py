from django.contrib import admin

from .models import AuditLog, ImportLog, Project, ProjectDocument, ProjectTag, ProjectTask, Tag, Theme, ThemeFile


class ProjectTagInline(admin.TabularInline):
    model = ProjectTag
    extra = 0
    autocomplete_fields = ("tag",)


class ProjectDocumentInline(admin.TabularInline):
    model = ProjectDocument
    extra = 0
    readonly_fields = ("created_at",)


class ThemeFileInline(admin.TabularInline):
    model = ThemeFile
    extra = 0
    readonly_fields = ("created_at", "updated_at")


@admin.register(Theme)
class ThemeAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "project_count", "file_count", "sort_order", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "description")
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = ("created_at", "updated_at")
    inlines = (ThemeFileInline,)
    fieldsets = (
        ("基础信息", {"fields": ("name", "slug", "description", "cover_image", "sort_order", "is_active")}),
        ("文件空间", {"fields": ("file_space",)}),
        ("时间", {"fields": ("created_at", "updated_at")}),
    )

    def project_count(self, obj):
        return obj.projects.count()

    def file_count(self, obj):
        return obj.files.count()


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "created_at")
    search_fields = ("name",)
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = ("created_at",)


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = (
        "topic_id",
        "title",
        "theme",
        "project_no",
        "stage",
        "llm_score",
        "community_score",
        "composite_score",
        "follow_count",
        "interest_count",
        "has_pdf",
        "is_public",
        "updated_at",
    )
    list_filter = ("theme", "stage", "has_pdf", "is_public", "imported_at")
    search_fields = ("topic_id", "title", "summary", "problem_statement", "source_md_path", "recommended_journal")
    readonly_fields = ("created_at", "updated_at", "imported_at")
    autocomplete_fields = ("theme",)
    inlines = (ProjectTagInline, ProjectDocumentInline)
    actions = ("mark_open_recruiting", "mark_team_building", "mark_active", "mark_archived")
    fieldsets = (
        ("基础信息", {"fields": ("topic_id", "title", "summary", "theme", "project_no", "stage", "is_public")}),
        ("结构化课题字段", {"fields": ("problem_statement", "research_goal", "technical_route", "data_requirements", "evaluation_metrics", "expected_outputs", "compliance_notes")}),
        ("评分与角色", {"fields": ("llm_score", "community_score", "composite_score", "recommended_journal", "needed_roles", "score_dimensions")}),
        ("来源与文件", {"fields": ("source_md_path", "source_pdf_path", "page_path", "content_hash", "has_pdf", "body_markdown")}),
        ("导入原始 JSON", {"fields": ("source_payload",), "classes": ("collapse",)}),
        ("时间", {"fields": ("created_at", "updated_at", "imported_at")}),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("theme").prefetch_related("follows", "interests")

    def follow_count(self, obj):
        return obj.follows.count()

    def interest_count(self, obj):
        return obj.interests.count()

    @admin.action(description="标记为开放招募")
    def mark_open_recruiting(self, request, queryset):
        queryset.update(stage="open_recruiting")

    @admin.action(description="标记为组队中")
    def mark_team_building(self, request, queryset):
        queryset.update(stage="team_building")

    @admin.action(description="标记为进行中")
    def mark_active(self, request, queryset):
        queryset.update(stage="active")

    @admin.action(description="标记为归档")
    def mark_archived(self, request, queryset):
        queryset.update(stage="archived")


@admin.register(ProjectDocument)
class ProjectDocumentAdmin(admin.ModelAdmin):
    list_display = ("project", "doc_type", "title", "path", "created_at")
    list_filter = ("doc_type",)
    search_fields = ("project__title", "path", "title")
    autocomplete_fields = ("project",)
    readonly_fields = ("created_at",)


@admin.register(ThemeFile)
class ThemeFileAdmin(admin.ModelAdmin):
    list_display = ("title", "theme", "section", "file_type", "path", "is_active", "sort_order", "updated_at")
    list_filter = ("theme", "section", "file_type", "is_active")
    search_fields = ("title", "description", "path", "theme__name")
    autocomplete_fields = ("theme",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(ProjectTask)
class ProjectTaskAdmin(admin.ModelAdmin):
    list_display = ("title", "project", "task_type", "required_role", "difficulty", "status", "assignee", "deadline", "updated_at")
    list_filter = ("status", "task_type", "required_role", "difficulty")
    search_fields = ("title", "description", "project__title")
    autocomplete_fields = ("project", "assignee")
    readonly_fields = ("created_at", "updated_at")


@admin.register(ImportLog)
class ImportLogAdmin(admin.ModelAdmin):
    list_display = ("source_file", "total_count", "created_count", "updated_count", "failed_count", "created_at")
    search_fields = ("source_file", "message")
    readonly_fields = ("source_file", "total_count", "created_count", "updated_count", "failed_count", "message", "created_at")


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("action", "target_type", "target_id", "actor", "created_at")
    list_filter = ("action", "target_type")
    search_fields = ("action", "target_type", "target_id")
    readonly_fields = ("actor", "action", "target_type", "target_id", "before", "after", "created_at")

# Register your models here.
