from django.contrib import admin

from .models import Contribution, CreditLedger


@admin.register(Contribution)
class ContributionAdmin(admin.ModelAdmin):
    list_display = ("title", "user", "project", "task", "status", "reviewer", "created_at", "reviewed_at")
    list_filter = ("status", "project__theme", "created_at")
    search_fields = ("title", "description", "user__username", "project__title", "file_path")
    autocomplete_fields = ("user", "project", "task", "reviewer")
    readonly_fields = ("created_at",)


@admin.register(CreditLedger)
class CreditLedgerAdmin(admin.ModelAdmin):
    list_display = ("user", "action_type", "amount", "balance_after", "project", "task", "created_by", "created_at")
    list_filter = ("action_type", "created_at")
    search_fields = ("user__username", "reason", "project__title", "task__title")
    autocomplete_fields = ("user", "project", "task", "created_by")
    readonly_fields = ("created_at",)

# Register your models here.
