import hashlib
import io
import json
import re
import time
import zipfile
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.forms import SetPasswordForm
from django.contrib.auth.models import User
from django.core.paginator import Paginator
from django.db import IntegrityError, OperationalError, close_old_connections, transaction
from django.db.models import Case, Exists, F, IntegerField, OuterRef, Q, Value, When
from django.http import Http404, HttpResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.text import slugify
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError, ValidationError
from ninja.security import SessionAuth

from config.release import APP_VERSION, release_payload
from accounts.forms import RegisterForm, UserProfileForm
from accounts.models import PLATFORM_ADMIN_UID, PUBLIC_ROLE_CHOICES, RoleType, UserProfile, normalize_public_role
from accounts.services import (
    DefaultPasswordConfigError,
    create_registered_user,
    get_system_default_password,
    reset_user_to_default_password,
)
from credits.models import Contribution, ContributionStatus, CreditLedger
from interactions.forms import ProjectClaimIntentForm, ProjectInterestForm, ProjectScoreForm, SponsorIntentForm
from interactions.models import (
    AuthorshipIntent,
    ClaimType,
    InteractionStatus,
    ParticipationRole,
    ProjectClaimIntent,
    ProjectFollow,
    ProjectInterest,
    ProjectScore,
    SponsorIntent,
    SponsorType,
)
from interactions.services import project_stat_annotations, recalculate_project_community_score
from projects.contracts import PROJECT_FIELD_CONTRACT, PROJECT_JSON_TEMPLATE
from projects.importing import create_project, unique_slug, update_project, upsert_project_with_instance
from projects.models import (
    FOLLOWABLE_PROJECT_STAGES,
    PUBLIC_PROJECT_STAGES,
    RECRUITING_PROJECT_STAGES,
    AuditLog,
    Project,
    ProjectDiscussion,
    ProjectDocument,
    ProjectProgressEntry,
    ProjectStage,
    ProjectTask,
    Tag,
    Theme,
    ThemeFile,
)

from .rbac import capabilities_for_user, has_capability
from .middleware import current_request_id
from .responses import form_errors
from .serializers import (
    admin_user_detail_payload,
    audit_log_payload,
    claim_payload,
    contribution_payload,
    credit_ledger_payload,
    dashboard_payload,
    document_payload,
    discussion_payload,
    admin_project_summary_payload,
    follow_payload,
    interest_payload,
    project_detail_payload,
    project_progress_payload,
    public_project_detail_payload,
    project_summary_payload,
    score_payload,
    sponsor_payload,
    tag_payload,
    task_payload,
    theme_file_payload,
    theme_payload,
    theme_dataset_payload,
    uid_only_user_payload,
    user_payload,
)


api = NinjaAPI(
    title="OpenMedAILab API",
    version=APP_VERSION,
    description="前后端分离 JSON API。认证使用 Django cookie session；写操作需要 X-CSRFToken。",
    docs_url="/docs",
    openapi_url="/openapi.json",
    auth=SessionAuth(),
)

REVIEWABLE_INTERACTION_STATUSES = {InteractionStatus.APPROVED, InteractionStatus.REJECTED}
REVIEW_REQUIRED_CLAIM_TYPES = {ClaimType.LEADER, ClaimType.PAPER_FIRST_UNIT}
REVIEWABLE_CONTRIBUTION_STATUSES = {ContributionStatus.APPROVED, ContributionStatus.REJECTED}
ACTIVE_VIEWER_INTERACTION_STATUSES = {InteractionStatus.APPROVED, InteractionStatus.PENDING}
ACTIVE_CLAIM_SLOT_STATUSES = {InteractionStatus.APPROVED, InteractionStatus.PENDING}
CLAIM_AVAILABILITY_TYPES = (ClaimType.LEADER, ClaimType.PAPER_FIRST_UNIT)
PROJECT_PARTICIPATION_CREDIT_COST = 50
PROJECT_COMPLETION_CREDIT_RETURN = 100
PROFILE_COMPLETION_BONUS = 5
CREDIT_TRANSFER_MAX_AMOUNT = 50
USER_PROJECT_ALLOWED_STAGES = {ProjectStage.DRAFT, ProjectStage.OPEN_RECRUITING}
DATABASE_LOCK_RETRY_ATTEMPTS = 5
DATABASE_LOCK_RETRY_DELAY_SECONDS = 0.05
DAILY_USER_PROJECT_UPLOAD_LIMIT = 10
AUDIT_ACTION_MAX_LENGTH = 120
AUDIT_TARGET_TYPE_MAX_LENGTH = 120
AUDIT_TARGET_ID_MAX_LENGTH = 120
AUDIT_SOURCE_MAX_LENGTH = 80
AUDIT_STATUS_MAX_LENGTH = 32
AUDIT_ERROR_CODE_MAX_LENGTH = 120
SIDEBAR_QR_DEFINITIONS = [
    {"key": "admin-contact", "label": "联系管理员", "icon": "support_agent"},
    {"key": "community", "label": "加入社区", "icon": "group_add"},
]
SIDEBAR_QR_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"]
SIDEBAR_QR_MAX_BYTES = 2 * 1024 * 1024
CONTRIBUTION_DOCUMENT_EXTENSIONS = {".pdf", ".md", ".markdown"}
CONTRIBUTION_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024
PDF_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024


class Envelope(Schema):
    ok: bool
    data: Any = None


class ErrorDetail(Schema):
    code: str
    message: str
    details: Optional[Any] = None
    request_id: Optional[str] = None


class ErrorEnvelope(Schema):
    ok: bool
    request_id: Optional[str] = None
    error: ErrorDetail
    errors: Optional[Any] = None


class RegisterRequest(Schema):
    username: str
    email: Optional[str] = ""
    display_name: Optional[str] = ""
    role_type: str = "undergrad_or_below"
    password1: str
    password2: str


class LoginRequest(Schema):
    username: str
    password: str


class ProfilePatchRequest(Schema):
    display_name: Optional[str] = None
    real_name: Optional[str] = None
    role_type: Optional[str] = None
    organization: Optional[str] = None
    title: Optional[str] = None
    research_interests: Optional[str] = None
    skills: Optional[str] = None
    available_hours_per_week: Optional[int] = None
    contact_email: Optional[str] = None
    contact_wechat: Optional[str] = None
    bio: Optional[str] = None


class ScoreRequest(Schema):
    score: int
    comment: Optional[str] = ""


class InterestRequest(Schema):
    role: str
    available_hours_per_week: int = 0
    experience: Optional[str] = ""
    message: Optional[str] = ""
    authorship_intention: str = AuthorshipIntent.CONTRIBUTION


class ClaimRequest(Schema):
    claim_type: str
    message: Optional[str] = ""
    claimed_unit_name: Optional[str] = ""


class SponsorRequest(Schema):
    sponsor_type: str
    note: Optional[str] = ""


class RequiredPasswordChangeRequest(Schema):
    password1: str
    password2: str


class ThemeWriteRequest(Schema):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = ""
    cover_image: Optional[str] = ""
    sort_order: Optional[int] = 0
    is_active: Optional[bool] = True


class ThemeReorderRequest(Schema):
    theme_ids: list[int]


class ProjectWriteRequest(Schema):
    id: Optional[Any] = None
    topic_id: Optional[Any] = None
    theme: Optional[Any] = None
    title: Optional[str] = None
    title_en: Optional[str] = ""
    summary: Optional[str] = ""
    problem_statement: Optional[str] = ""
    clinical_endpoint: Optional[str] = ""
    existing_foundation: Optional[str] = ""
    team_requirements: Optional[str] = ""
    project_progress: Optional[str] = ""
    target_venue: Optional[str] = ""
    stage: Optional[str] = None
    tags: Optional[list[str]] = None
    is_public: Optional[bool] = None


class ProjectBulkImportRequest(Schema):
    projects: list[ProjectWriteRequest]
    publish: Optional[bool] = False
    auto_number: Optional[bool] = False


class ProjectBulkArchiveRequest(Schema):
    ids: list[int]


class ProjectBulkActionRequest(Schema):
    ids: list[int]
    action: str
    stage: Optional[str] = None
    is_public: Optional[bool] = None


class ProjectDocumentWriteRequest(Schema):
    doc_type: Optional[str] = None
    document_kind: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    path: Optional[str] = None


class ProjectDiscussionWriteRequest(Schema):
    content: str
    parent_id: Optional[int] = None


class ProjectDiscussionModerationRequest(Schema):
    status: str
    moderation_reason: Optional[str] = ""


class ThemeFileWriteRequest(Schema):
    theme_id: Optional[int] = None
    theme: Optional[Any] = None
    section: Optional[str] = "数据集文件"
    file_type: Optional[str] = "other"
    title: Optional[str] = None
    description: Optional[str] = ""
    path: Optional[str] = None
    detail_pdf_title: Optional[str] = ""
    detail_pdf_path: Optional[str] = ""
    sort_order: Optional[int] = 0
    is_active: Optional[bool] = True


class InteractionStatusRequest(Schema):
    status: str
    review_note: Optional[str] = ""


class InteractionWithdrawRequest(Schema):
    reason: Optional[str] = ""


class CreditTransferRequest(Schema):
    target_uid: str
    amount: int
    reason: Optional[str] = ""


class TaskWriteRequest(Schema):
    project_id: int
    title: str
    description: Optional[str] = ""
    task_type: Optional[str] = ""
    required_role: Optional[str] = ""
    difficulty: Optional[int] = 1
    status: Optional[str] = None
    assignee_uid: Optional[str] = ""
    deadline: Optional[date] = None
    credit_deposit: Optional[int] = 0
    credit_reward: Optional[int] = 0


class TaskPatchRequest(Schema):
    project_id: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None
    task_type: Optional[str] = None
    required_role: Optional[str] = None
    difficulty: Optional[int] = None
    status: Optional[str] = None
    assignee_uid: Optional[str] = None
    deadline: Optional[date] = None
    credit_deposit: Optional[int] = None
    credit_reward: Optional[int] = None


class TaskAssignRequest(Schema):
    uid: str


class TaskStatusRequest(Schema):
    status: str


class ContributionWriteRequest(Schema):
    project_id: int
    task_id: Optional[int] = None
    title: str
    result_type: Optional[str] = "stage"
    description: Optional[str] = ""
    file_path: Optional[str] = ""


class ContributionReviewRequest(Schema):
    status: str
    review_comment: Optional[str] = ""
    grant_reward: bool = False


@api.exception_handler(Http404)
def not_found_handler(request, exc):
    return api.create_response(request, error_payload("Resource not found.", "not_found"), status=404)


@api.exception_handler(HttpError)
def http_error_handler(request, exc):
    status = exc.status_code
    if status == 401:
        return api.create_response(request, error_payload("Authentication required.", "auth_required"), status=status)
    if status == 403 and "CSRF" in str(exc).upper():
        return api.create_response(request, error_payload("CSRF check failed.", "csrf_failed"), status=status)
    if status == 403:
        return api.create_response(request, error_payload("Forbidden.", "forbidden"), status=status)
    return api.create_response(request, error_payload(str(exc), "http_error"), status=status)


@api.exception_handler(ValidationError)
def validation_error_handler(request, exc):
    return api.create_response(
        request,
        error_payload("Request validation failed.", "validation_error", exc.errors),
        status=422,
    )


@api.get("/health/", response={200: Envelope}, tags=["System"], auth=None)
def health(request):
    return ok({"status": "ok"})


@api.get("/csrf/", response={200: Envelope}, tags=["System"], auth=None)
def csrf(request):
    return ok({"csrf_token": get_token(request)})


def platform_stats_payload():
    online_window_seconds = getattr(settings, "OPENMEDAILAB_ONLINE_WINDOW_SECONDS", 300)
    online_since = timezone.now() - timedelta(seconds=online_window_seconds)
    return {
        "registered_user_count": UserProfile.objects.filter(user__is_active=True).count(),
        "online_user_count": UserProfile.objects.filter(user__is_active=True, last_seen_at__gte=online_since).count(),
        "online_window_seconds": online_window_seconds,
    }


def sidebar_qr_entries_payload():
    return [sidebar_qr_entry_payload(item) for item in SIDEBAR_QR_DEFINITIONS]


def sidebar_qr_entry_payload(definition):
    path = sidebar_qr_existing_file(definition["key"])
    image = ""
    updated_at = None
    if path:
        image = f"{public_media_path(path)}?v={int(path.stat().st_mtime)}"
        updated_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.get_current_timezone()).isoformat()
    return {
        "key": definition["key"],
        "label": definition["label"],
        "icon": definition["icon"],
        "image": image,
        "has_image": bool(path),
        "updated_at": updated_at,
    }


@api.get("/meta/", response={200: Envelope}, tags=["System"], auth=None)
def meta(request):
    return ok(
        {
            "themes": [theme_payload(theme) for theme in Theme.objects.filter(is_active=True).order_by("sort_order", "name")],
            "tags": [tag_payload(tag) for tag in Tag.objects.order_by("name")[:200]],
            "project_stages": choice_payload(ProjectStage.choices),
            "profile_roles": choice_payload(PUBLIC_ROLE_CHOICES),
            "participation_roles": choice_payload(ParticipationRole.choices),
            "authorship_intents": choice_payload(AuthorshipIntent.choices),
            "claim_types": choice_payload(ClaimType.choices),
            "sponsor_types": choice_payload(SponsorType.choices),
            "platform_stats": platform_stats_payload(),
            "sidebar_qr_entries": sidebar_qr_entries_payload(),
            "release": release_payload(),
        }
    )


@api.get("/sidebar-qrs/", response={200: Envelope}, tags=["System"], auth=None)
def sidebar_qrs(request):
    return ok({"entries": sidebar_qr_entries_payload()})


@api.get("/rbac/", response={200: Envelope}, tags=["System"], auth=None)
def rbac(request):
    return ok(capabilities_for_user(request.user))


@api.get("/project-schema/", response={200: Envelope}, tags=["Projects"], auth=None)
def project_schema(request):
    return ok(
        {
            "fields": PROJECT_FIELD_CONTRACT,
            "json_template": PROJECT_JSON_TEMPLATE,
            "template_version": "v1",
            "stage_values": choice_payload(ProjectStage.choices),
            "document_types": choice_payload([(ProjectDocument.DocumentType.PDF, ProjectDocument.DocumentType.PDF.label)]),
            "document_kinds": choice_payload(
                [
                    (ProjectDocument.DocumentKind.DETAIL, ProjectDocument.DocumentKind.DETAIL.label),
                    (ProjectDocument.DocumentKind.PROGRESS, ProjectDocument.DocumentKind.PROGRESS.label),
                ]
            ),
            "theme_file_types": choice_payload([(ThemeFile.FileType.DATASET_META, ThemeFile.FileType.DATASET_META.label)]),
        }
    )


@api.get("/themes/{slug}/datasets/", response={200: Envelope, 404: ErrorEnvelope}, tags=["Projects"], auth=None)
def theme_datasets(request, slug: str):
    theme = get_object_or_404(Theme, slug=slug, is_active=True)
    projects = list(
        project_stat_annotations(
            Project.objects.filter(theme=theme, is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
            .select_related("theme")
            .prefetch_related("tags", "documents")
        ).order_by("topic_id", "-updated_at")[:80]
    )
    files = list(ThemeFile.objects.filter(theme=theme, is_active=True).order_by("sort_order", "section", "title")[:300])
    return ok(theme_dataset_payload(theme, projects, files))


@api.get("/me/", response={200: Envelope, 401: ErrorEnvelope}, tags=["Me"])
def me(request):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    return ok(user_payload(request.user))


@api.post("/auth/register/", response={201: Envelope, 422: ErrorEnvelope}, tags=["Auth"], auth=None)
def register(request, payload: RegisterRequest):
    data = payload.model_dump()
    form = RegisterForm(data)
    if not form.is_valid():
        audit(
            None,
            "auth.register",
            "User",
            data.get("username") or "new",
            after=audit_submitted_user_payload(data),
            status="failed",
            error_code="validation_error",
            error_message="Registration failed.",
        )
        return fail("Registration failed.", status=422, code="validation_error", errors=form_errors(form))
    user = create_registered_user(form)
    login(request, user)
    audit(user, "auth.register", "User", audit_user_target_id(user), after=audit_user_snapshot(user))
    return 201, ok(user_payload(user))


@api.post("/auth/login/", response={200: Envelope, 400: ErrorEnvelope}, tags=["Auth"], auth=None)
def login_view(request, payload: LoginRequest):
    user = authenticate(request, username=payload.username, password=payload.password)
    if user is None:
        audit(
            None,
            "auth.login",
            "User",
            payload.username or "unknown",
            after={"username": payload.username or ""},
            status="failed",
            error_code="invalid_credentials",
            error_message="用户名或密码错误。",
        )
        return fail("用户名或密码错误。", status=400, code="invalid_credentials")
    login(request, user)
    audit(user, "auth.login", "User", audit_user_target_id(user), after=audit_user_snapshot(user))
    return ok(user_payload(user))


@api.post("/auth/logout/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Auth"])
def logout_view(request):
    actor = request.user if request.user.is_authenticated else None
    target_id = audit_user_target_id(actor) if actor else "unknown"
    before = audit_user_snapshot(actor) if actor else {}
    logout(request)
    audit(actor, "auth.logout", "User", target_id, before=before, after={"logged_out": True})
    return ok({"logged_out": True})


@api.post("/auth/password/change-required/", response={200: Envelope, 401: ErrorEnvelope, 400: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Auth"])
def password_change_required(request, payload: RequiredPasswordChangeRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    user_before = audit_user_snapshot(request.user)
    if not request.user.profile.must_change_password:
        audit(
            request.user,
            "auth.password_change_required",
            "User",
            audit_user_target_id(request.user),
            before=user_before,
            status="failed",
            error_code="password_change_not_required",
            error_message="Password change is not required.",
        )
        return fail("Password change is not required.", status=400, code="password_change_not_required")
    form = SetPasswordForm(
        request.user,
        {"new_password1": payload.password1, "new_password2": payload.password2},
    )
    if not form.is_valid():
        audit(
            request.user,
            "auth.password_change_required",
            "User",
            audit_user_target_id(request.user),
            before=user_before,
            status="failed",
            error_code="validation_error",
            error_message="Password reset failed.",
        )
        return fail("Password reset failed.", status=422, code="validation_error", errors=password_reset_form_errors(form))
    try:
        system_default_password = get_system_default_password()
    except DefaultPasswordConfigError:
        system_default_password = None
    if system_default_password and payload.password1 == system_default_password:
        audit(
            request.user,
            "auth.password_change_required",
            "User",
            audit_user_target_id(request.user),
            before=user_before,
            status="failed",
            error_code="password_unchanged",
            error_message="Password reset failed.",
        )
        return fail(
            "Password reset failed.",
            status=422,
            code="validation_error",
            errors={"password1": [{"message": "新密码不能与系统默认密码相同。", "code": "password_unchanged"}]},
        )
    if request.user.check_password(payload.password1):
        audit(
            request.user,
            "auth.password_change_required",
            "User",
            audit_user_target_id(request.user),
            before=user_before,
            status="failed",
            error_code="password_unchanged",
            error_message="Password reset failed.",
        )
        return fail(
            "Password reset failed.",
            status=422,
            code="validation_error",
            errors={"password1": [{"message": "新密码不能与默认密码相同。", "code": "password_unchanged"}]},
        )
    form.save()
    profile = request.user.profile
    profile.must_change_password = False
    profile.save(update_fields=["must_change_password", "updated_at"])
    user_after = audit_user_snapshot(request.user)
    audit(
        request.user,
        "auth.password_change_required",
        "User",
        audit_user_target_id(request.user),
        before=user_before,
        after=user_after,
    )
    logout(request)
    return ok({"password_changed": True, "logged_out": True})


@api.get("/me/profile/", response={200: Envelope, 401: ErrorEnvelope}, tags=["Me"])
def profile_get(request):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    return ok(user_payload(request.user))


@api.patch("/me/profile/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Me"])
def profile_patch(request, payload: ProfilePatchRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    before = audit_user_snapshot(request.user)
    data = profile_form_initial(request.user.profile)
    data.update({key: value for key, value in payload.model_dump().items() if value is not None})
    form = UserProfileForm(data, instance=request.user.profile)
    if not form.is_valid():
        audit(
            request.user,
            "profile.update",
            "UserProfile",
            audit_user_target_id(request.user),
            before=before,
            after=safe_profile_update_payload(payload.model_dump()),
            status="failed",
            error_code="validation_error",
            error_message="Profile update failed.",
        )
        return fail("Profile update failed.", status=422, code="validation_error", errors=form_errors(form))
    with transaction.atomic():
        form.save()
        bonus_entry = grant_profile_completion_bonus_once(request.user, request.user)
    request.user.refresh_from_db()
    request.user.profile.refresh_from_db()
    audit(request.user, "profile.update", "UserProfile", audit_user_target_id(request.user), before=before, after=audit_user_snapshot(request.user))
    if bonus_entry:
        audit(request.user, "credit.profile_completion_bonus", "CreditLedger", bonus_entry.pk, after=credit_ledger_payload(bonus_entry))
    return ok(user_payload(request.user))


@api.put("/me/profile/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Me"])
def profile_put(request, payload: ProfilePatchRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    before = audit_user_snapshot(request.user)
    form = UserProfileForm(payload.model_dump(), instance=request.user.profile)
    if not form.is_valid():
        audit(
            request.user,
            "profile.update",
            "UserProfile",
            audit_user_target_id(request.user),
            before=before,
            after=safe_profile_update_payload(payload.model_dump()),
            status="failed",
            error_code="validation_error",
            error_message="Profile update failed.",
        )
        return fail("Profile update failed.", status=422, code="validation_error", errors=form_errors(form))
    with transaction.atomic():
        form.save()
        bonus_entry = grant_profile_completion_bonus_once(request.user, request.user)
    request.user.refresh_from_db()
    request.user.profile.refresh_from_db()
    audit(request.user, "profile.update", "UserProfile", audit_user_target_id(request.user), before=before, after=audit_user_snapshot(request.user))
    if bonus_entry:
        audit(request.user, "credit.profile_completion_bonus", "CreditLedger", bonus_entry.pk, after=credit_ledger_payload(bonus_entry))
    return ok(user_payload(request.user))


def with_self_relation_rank(projects, user):
    if not getattr(user, "is_authenticated", False):
        return projects
    active_statuses = ACTIVE_VIEWER_INTERACTION_STATUSES
    claim_exists = ProjectClaimIntent.objects.filter(
        project=OuterRef("pk"),
        user=user,
        claim_type__in=[ClaimType.LEADER, ClaimType.PAPER_FIRST_UNIT],
        status__in=active_statuses,
    )
    interest_exists = ProjectInterest.objects.filter(
        project=OuterRef("pk"),
        user=user,
        status__in=active_statuses,
    )
    sponsor_exists = SponsorIntent.objects.filter(
        project=OuterRef("pk"),
        user=user,
        status__in=active_statuses,
    )
    return projects.annotate(
        self_has_claim=Exists(claim_exists),
        self_has_interest=Exists(interest_exists),
        self_has_sponsor=Exists(sponsor_exists),
        self_relation_rank=Case(
            When(self_has_claim=True, then=Value(0)),
            When(self_has_interest=True, then=Value(1)),
            When(self_has_sponsor=True, then=Value(2)),
            default=Value(3),
            output_field=IntegerField(),
        ),
    )


@api.get("/projects/", response={200: Envelope}, tags=["Projects"], auth=None)
def project_list(
    request,
    q: str = "",
    theme: str = "",
    tag: str = "",
    stage: str = "",
    sort: str = "recommended",
    page: int = 1,
    page_size: int = 20,
):
    projects = project_stat_annotations(
        Project.objects.filter(is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
        .select_related("theme", "created_by", "created_by__profile")
        .prefetch_related("tags", "documents")
    )
    q = q.strip()
    theme = theme.strip()
    tag = tag.strip()
    stage = stage.strip()

    if q:
        projects = projects.filter(project_search_q(q) | Q(tags__name__icontains=q)).distinct()
    if theme:
        projects = projects.filter(Q(theme__slug=theme) | Q(theme__name=theme))
    if tag:
        projects = projects.filter(Q(tags__slug=tag) | Q(tags__name=tag))
    if stage:
        projects = projects.filter(stage=stage)
    projects = projects.annotate(default_engagement_count=F("score_count") + F("follow_count"))
    sort_map = {
        "recommended": ("-default_engagement_count", "-score_count", "-follow_count", "topic_id", "id"),
        "follows": ("-follow_count", "-interest_count", "topic_id"),
        "likes": ("-score_count", "-follow_count", "-interest_count", "topic_id"),
        "updated": ("-updated_at", "-topic_id"),
        "newest": ("-topic_id", "-id"),
        "project_id": ("topic_id", "id"),
    }
    sort = sort if sort in sort_map else "recommended"
    sort_fields = sort_map[sort]
    if sort == "recommended" and getattr(request.user, "is_authenticated", False):
        projects = with_self_relation_rank(projects, request.user)
        projects = projects.order_by("self_relation_rank", *sort_fields)
    else:
        projects = projects.order_by(*sort_fields)

    page_size = max(1, min(page_size, 100))
    paginator = Paginator(projects, page_size)
    page_obj = paginator.get_page(page)
    return ok(
        {
            "results": [project_list_payload(project, request.user) for project in page_obj.object_list],
            "pagination": {
                "page": page_obj.number,
                "page_size": page_size,
                "total_pages": paginator.num_pages,
                "total_count": paginator.count,
                "has_next": page_obj.has_next(),
                "has_previous": page_obj.has_previous(),
            },
            "filters": {"q": q, "theme": theme, "tag": tag, "stage": stage, "sort": sort},
        }
    )


@api.get("/projects/{project_id}/", response={200: Envelope, 404: ErrorEnvelope}, tags=["Projects"], auth=None)
def project_detail(request, project_id: int):
    project = get_object_or_404(
        project_stat_annotations(
            Project.objects.filter(is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
            .select_related("theme", "created_by", "created_by__profile")
            .prefetch_related("tags", "documents")
        ),
        pk=project_id,
    )
    data = public_project_detail_payload(project)
    data["claim_availability"] = claim_availability_payload(request.user, project)
    if request.user.is_authenticated:
        data["viewer_state"] = viewer_state(request.user, project)
    return ok(data)


@api.get("/projects/{project_id}/progress/", response={200: Envelope, 404: ErrorEnvelope}, tags=["Projects"], auth=None)
def project_progress(request, project_id: int):
    project = get_visible_project_for_project_page(request, project_id)
    if not project:
        raise Http404("Project not found.")
    include_private = can_view_project_private_content(request.user, project)
    documents = project_progress_documents_queryset(project, include_private)
    timeline = project_progress_entries_queryset(project, include_private)
    data = project_progress_payload(project, documents, timeline)
    data["project"]["claim_availability"] = claim_availability_payload(request.user, project)
    if request.user.is_authenticated:
        data["project"]["viewer_state"] = viewer_state(request.user, project)
    return ok(data)


@api.get("/projects/{project_id}/status-card/", response={200: Envelope, 404: ErrorEnvelope}, tags=["Projects"], auth=None)
def project_status_card(request, project_id: int):
    if request.user.is_authenticated and has_capability(request.user, "manage_projects"):
        project_queryset = Project.objects.all()
    else:
        project_queryset = Project.objects.filter(is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
    project = get_object_or_404(
        project_stat_annotations(
            project_queryset
            .select_related("theme", "created_by", "created_by__profile")
            .prefetch_related("tags", "documents")
        ),
        pk=project_id,
    )
    participant_uids = participant_uids_for_project(project)
    viewer_state_payload = viewer_state(request.user, project) if request.user.is_authenticated else {"is_following": False}
    status_uids = status_uids_for_project(participant_uids, viewer_state_payload, bool(request.user.is_authenticated))
    uid_groups = status_uid_groups_for_project(project, bool(request.user.is_authenticated))
    return ok(
        {
            "project": project_list_payload(project, request.user),
            "viewer_state": viewer_state_payload,
            "claim_availability": claim_availability_payload(request.user, project),
            "participants": {
                "count": len(participant_uids),
                "uids_visible": bool(request.user.is_authenticated),
                "uids": participant_uids if request.user.is_authenticated else [],
            },
            "status_uids": status_uids,
            "uid_groups": uid_groups,
            "status": {
                "stage": project.stage,
                "stage_label": project.get_stage_display(),
                "follow_count": getattr(project, "follow_count", None),
                "interest_count": getattr(project, "interest_count", None),
                "sponsor_count": getattr(project, "sponsor_count", None),
                "basic_ready": project.team_status.get("basic_ready"),
            },
        }
    )


@api.get("/projects/{project_id}/discussions/", response={200: Envelope, 404: ErrorEnvelope}, tags=["Projects"], auth=None)
def project_discussion_list(request, project_id: int, page: int = 1, page_size: int = 20, sort: str = "newest"):
    project = get_public_project_for_discussions(project_id)
    discussions = ProjectDiscussion.objects.filter(project=project, parent__isnull=True, status=ProjectDiscussion.Status.VISIBLE).select_related("author", "author__profile")
    discussions = discussions.order_by("created_at", "id") if sort == "oldest" else discussions.order_by("-created_at", "-id")
    page_size = max(1, min(page_size, 50))
    paginator = Paginator(discussions, page_size)
    page_obj = paginator.get_page(page)
    roots = list(page_obj.object_list)
    replies_by_parent = visible_replies_by_parent(roots)
    return ok(
        {
            "results": [discussion_payload(item, replies_by_parent.get(item.id, [])) for item in roots],
            "pagination": {
                "page": page_obj.number,
                "page_size": page_size,
                "total_pages": paginator.num_pages,
                "total_count": paginator.count,
                "has_next": page_obj.has_next(),
                "has_previous": page_obj.has_previous(),
            },
        }
    )


@api.post("/projects/{project_id}/discussions/", response={201: Envelope, 401: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Projects"])
def project_discussion_create(request, project_id: int, payload: ProjectDiscussionWriteRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_public_project_for_discussions(project_id)
    content, error = validate_discussion_content(payload.content)
    if error:
        return error
    parent = None
    if payload.parent_id:
        parent = get_object_or_404(ProjectDiscussion, pk=payload.parent_id, project=project, status=ProjectDiscussion.Status.VISIBLE)
        if parent.parent_id:
            return fail("Replies can only target top-level discussions.", status=422, code="validation_error")
    discussion = ProjectDiscussion.objects.create(project=project, author=request.user, parent=parent, content=content)
    audit(request.user, "project_discussion.create", "ProjectDiscussion", discussion.id, after=discussion_audit_snapshot(discussion))
    return 201, ok(discussion_payload(discussion))


@api.patch("/project-discussions/{discussion_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Projects"])
def project_discussion_update(request, discussion_id: int, payload: ProjectDiscussionWriteRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    discussion = get_object_or_404(ProjectDiscussion.objects.select_related("project", "author", "author__profile"), pk=discussion_id)
    if not can_manage_discussion(request.user, discussion):
        return fail("Permission denied.", status=403, code="permission_denied")
    if discussion.status != ProjectDiscussion.Status.VISIBLE:
        return fail("Discussion is not editable.", status=422, code="validation_error")
    content, error = validate_discussion_content(payload.content)
    if error:
        return error
    before = discussion_audit_snapshot(discussion)
    discussion.content = content
    discussion.save(update_fields=["content", "updated_at"])
    audit(request.user, "project_discussion.update", "ProjectDiscussion", discussion.id, before=before, after=discussion_audit_snapshot(discussion))
    return ok(discussion_payload(discussion))


@api.delete("/project-discussions/{discussion_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Projects"])
def project_discussion_delete(request, discussion_id: int):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    discussion = get_object_or_404(ProjectDiscussion.objects.select_related("project", "author", "author__profile"), pk=discussion_id)
    if not can_manage_discussion(request.user, discussion):
        return fail("Permission denied.", status=403, code="permission_denied")
    before = discussion_audit_snapshot(discussion)
    discussion.status = ProjectDiscussion.Status.DELETED
    discussion.deleted_at = timezone.now()
    discussion.deleted_by = request.user
    discussion.save(update_fields=["status", "deleted_at", "deleted_by", "updated_at"])
    audit(request.user, "project_discussion.delete", "ProjectDiscussion", discussion.id, before=before, after=discussion_audit_snapshot(discussion))
    return ok({"id": discussion.id, "deleted": True})


@api.post("/projects/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Projects"])
def user_project_create(request, payload: ProjectWriteRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    normalize_project_identity_alias(data)
    data.pop("is_public", None)
    error = validate_user_project_payload(data, creating=True)
    if error:
        audit(
            request.user,
            "project.user_create",
            "Project",
            "new",
            after=data,
            status="failed",
            error_code=error[1]["error"]["code"],
            error_message=error[1]["error"]["message"],
        )
        return error
    if data.get("topic_id") and Project.objects.filter(topic_id=data["topic_id"]).exists():
        audit(
            request.user,
            "project.user_create",
            "Project",
            "new",
            after=data,
            status="failed",
            error_code="validation_error",
            error_message="id already exists.",
        )
        return fail("id already exists.", status=422, code="validation_error")
    try:
        with transaction.atomic():
            if not user_can_bypass_project_upload_quota(request.user):
                User.objects.select_for_update().get(pk=request.user.pk)
                if user_project_uploads_today(request.user) >= DAILY_USER_PROJECT_UPLOAD_LIMIT:
                    audit(
                        request.user,
                        "project.user_create",
                        "Project",
                        "new",
                        after={"title": payload.title or "", "limit": DAILY_USER_PROJECT_UPLOAD_LIMIT},
                        status="failed",
                        error_code="daily_project_upload_limit_exceeded",
                        error_message="普通用户每天最多上传 10 个课题。",
                    )
                    return fail("普通用户每天最多上传 10 个课题。", status=422, code="daily_project_upload_limit_exceeded")
            project = create_project(data, source_label="api-user", allow_create_theme=False, created_by=request.user)
            project = Project.objects.select_related("theme", "created_by", "created_by__profile").prefetch_related("tags", "documents").get(pk=project.pk)
            audit(request.user, "project.user_create", "Project", project.id, after=project_detail_payload(project))
    except ValueError as exc:
        audit(
            request.user,
            "project.user_create",
            "Project",
            "new",
            after=data,
            status="failed",
            error_code="validation_error",
            error_message=str(exc),
        )
        return fail(str(exc), status=422, code="validation_error")
    return 201, ok(project_detail_payload(project))


@api.patch("/projects/{project_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Projects"])
def user_project_update(request, project_id: int, payload: ProjectWriteRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project.objects.select_related("theme", "created_by", "created_by__profile").prefetch_related("tags", "documents"), pk=project_id)
    ownership_error = require_project_owner_or_admin(request, project, "project.user_update")
    if ownership_error:
        return ownership_error
    before = project_detail_payload(project)
    patch_data = payload.model_dump(exclude_unset=True, exclude_none=True)
    normalize_project_identity_alias(patch_data)
    patch_data.pop("is_public", None)
    if "topic_id" in patch_data and patch_data["topic_id"] != project.topic_id:
        audit(
            request.user,
            "project.user_update",
            "Project",
            project.id,
            before=before,
            after=patch_data,
            status="failed",
            error_code="validation_error",
            error_message="topic_id cannot be changed.",
        )
        return fail("topic_id cannot be changed.", status=422, code="validation_error")
    if not user_can_bypass_project_upload_quota(request.user) and project.stage not in USER_PROJECT_ALLOWED_STAGES and "stage" in patch_data:
        audit(
            request.user,
            "project.user_update",
            "Project",
            project.id,
            before=before,
            after=patch_data,
            status="failed",
            error_code="user_project_stage_locked",
            error_message="当前课题阶段只能由管理员修改。",
        )
        return fail("当前课题阶段只能由管理员修改。", status=422, code="user_project_stage_locked")
    data = project_import_payload(project)
    data.update(patch_data)
    data["topic_id"] = project.topic_id
    error = validate_user_project_payload(data, creating=False, current_project=project, stage_change_requested="stage" in patch_data)
    if error:
        audit(
            request.user,
            "project.user_update",
            "Project",
            project.id,
            before=before,
            after=data,
            status="failed",
            error_code=error[1]["error"]["code"],
            error_message=error[1]["error"]["message"],
        )
        return error
    try:
        with transaction.atomic():
            project = update_project(project, data, source_label="api-user", allow_create_theme=False)
            project = Project.objects.select_related("theme", "created_by", "created_by__profile").prefetch_related("tags", "documents").get(pk=project.pk)
            audit(request.user, "project.user_update", "Project", project.id, before=before, after=project_detail_payload(project))
    except ValueError as exc:
        audit(
            request.user,
            "project.user_update",
            "Project",
            project.id,
            before=before,
            after=data,
            status="failed",
            error_code="validation_error",
            error_message=str(exc),
        )
        return fail(str(exc), status=422, code="validation_error")
    return ok(project_detail_payload(project))


@api.delete("/projects/{project_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Projects"])
def user_project_delete(request, project_id: int):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project.objects.select_related("theme", "created_by", "created_by__profile").prefetch_related("tags", "documents"), pk=project_id)
    ownership_error = require_project_owner_or_admin(request, project, "project.user_archive")
    if ownership_error:
        return ownership_error
    before = project_detail_payload(project)
    with transaction.atomic():
        project.is_public = False
        project.stage = ProjectStage.ARCHIVED
        project.save(update_fields=["is_public", "stage", "updated_at"])
        project.refresh_from_db()
        audit(request.user, "project.user_archive", "Project", project.id, before=before, after=project_detail_payload(project))
    return ok(project_detail_payload(project))


@api.get("/me/dashboard/", response={200: Envelope, 401: ErrorEnvelope}, tags=["Me"])
def dashboard(request):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    follows = ProjectFollow.objects.filter(user=request.user).select_related("project", "project__theme").prefetch_related("project__tags").order_by("-created_at")
    interests = ProjectInterest.objects.filter(user=request.user).select_related("project", "project__theme").prefetch_related("project__tags").order_by("-updated_at")
    claims = ProjectClaimIntent.objects.filter(user=request.user).select_related("project", "project__theme").prefetch_related("project__tags").order_by("-updated_at")
    sponsors = SponsorIntent.objects.filter(user=request.user).select_related("project", "project__theme").prefetch_related("project__tags").order_by("-updated_at")
    scores = ProjectScore.objects.filter(user=request.user).select_related("project", "project__theme").prefetch_related("project__tags").order_by("-updated_at")
    tasks = (
        ProjectTask.objects.filter(assignee=request.user)
        .select_related("project", "project__theme", "assignee")
        .prefetch_related("project__tags")
        .order_by("-updated_at")
    )
    contributions = (
        Contribution.objects.filter(user=request.user)
        .select_related("user", "project", "project__theme", "task", "task__project", "reviewer")
        .prefetch_related("project__tags", "task__project__tags")
        .order_by("-created_at")
    )
    credits = (
        CreditLedger.objects.filter(user=request.user)
        .select_related("user", "project", "project__theme", "task", "task__project", "created_by")
        .prefetch_related("project__tags", "task__project__tags")
        .order_by("-created_at")[:50]
    )
    return ok(dashboard_payload(request.user, follows, interests, claims, sponsors, scores, tasks, contributions, credits))


@api.get("/me/projects/", response={200: Envelope, 401: ErrorEnvelope}, tags=["Me"])
def me_project_list(request, page: int = 1, page_size: int = 20):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    projects = (
        project_stat_annotations(
            Project.objects.filter(created_by=request.user)
            .select_related("theme", "created_by", "created_by__profile")
            .prefetch_related("tags", "documents")
        )
        .order_by("-created_at", "topic_id")
    )
    quota_unlimited = user_can_bypass_project_upload_quota(request.user)
    used_today = user_project_uploads_today(request.user)
    quota = {
        "daily_limit": None if quota_unlimited else DAILY_USER_PROJECT_UPLOAD_LIMIT,
        "used_today": used_today,
        "remaining": None if quota_unlimited else max(0, DAILY_USER_PROJECT_UPLOAD_LIMIT - used_today),
        "unlimited": quota_unlimited,
    }
    return ok({**paginated_queryset(projects, page, page_size, admin_project_summary_payload, max_page_size=100), "quota": quota})


@api.get("/admin/users/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_user_list(request, q: str = "", page: int = 1, page_size: int = 50):
    auth_error = require_capability(request, "manage_users")
    if auth_error:
        return auth_error
    users = (
        User.objects.select_related("profile")
        .annotate(
            admin_sort=Case(
                When(profile__uid=PLATFORM_ADMIN_UID, then=Value(0)),
                default=Value(1),
                output_field=IntegerField(),
            ),
            empty_uid_sort=Case(
                When(profile__uid__isnull=True, then=Value(1)),
                When(profile__uid="", then=Value(1)),
                default=Value(0),
                output_field=IntegerField(),
            ),
        )
        .order_by("admin_sort", "empty_uid_sort", "profile__uid", "id")
    )
    q = q.strip()
    if q:
        users = users.filter(
            Q(username__icontains=q)
            | Q(email__icontains=q)
            | Q(profile__uid__icontains=q)
            | Q(profile__display_name__icontains=q)
        ).distinct()
    page_size = max(1, min(page_size, 200))
    paginator = Paginator(users, page_size)
    page_obj = paginator.get_page(page)
    return ok(
        {
            "results": [user_payload(user) for user in page_obj.object_list],
            "pagination": {
                "page": page_obj.number,
                "page_size": page_size,
                "total_pages": paginator.num_pages,
                "total_count": paginator.count,
                "has_next": page_obj.has_next(),
                "has_previous": page_obj.has_previous(),
            },
        }
    )


@api.post("/admin/users/{uid}/reset-password/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_user_reset_password(request, uid: str):
    auth_error = require_capability(request, "manage_users")
    if auth_error:
        return auth_error
    profile = get_object_or_404(UserProfile.objects.select_related("user"), uid=uid)
    if profile.user_id == request.user.id:
        return fail("管理员不能恢复自己的密码。", status=422, code="self_reset_forbidden")
    try:
        default_password = reset_user_to_default_password(profile.user)
    except DefaultPasswordConfigError as exc:
        return fail(str(exc), status=422, code="default_password_not_configured")
    profile.refresh_from_db()
    audit(request.user, "user.reset_password", "User", profile.user_id, after={"uid": uid, "must_change_password": True})
    return ok({"user": user_payload(profile.user), "default_password": default_password})


@api.get("/admin/overview/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_overview(request):
    auth_error = require_capability(request, "view_admin_console")
    if auth_error:
        return auth_error
    return ok(
        {
            "counts": {
                "users": User.objects.count(),
                "projects": Project.objects.count(),
                "themes": Theme.objects.count(),
                "pending_interactions": pending_interaction_count(),
                "active_tasks": ProjectTask.objects.exclude(status__in=[ProjectTask.TaskStatus.DONE, ProjectTask.TaskStatus.CANCELLED]).count(),
                "submitted_contributions": Contribution.objects.filter(status=ContributionStatus.SUBMITTED).count(),
                "credit_entries": CreditLedger.objects.count(),
                "audit_logs": AuditLog.objects.count(),
            }
        }
    )


@api.get("/admin/users/{uid}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Admin"])
def admin_user_detail(request, uid: str):
    auth_error = require_capability(request, "manage_users")
    if auth_error:
        return auth_error
    profile = get_object_or_404(UserProfile.objects.select_related("user"), uid=uid)
    user = profile.user
    follows = ProjectFollow.objects.filter(user=user).select_related("project", "project__theme").prefetch_related("project__tags").order_by("-created_at")[:100]
    interests = ProjectInterest.objects.filter(user=user).select_related("project", "project__theme").prefetch_related("project__tags").order_by("-updated_at")[:100]
    claims = ProjectClaimIntent.objects.filter(user=user).select_related("project", "project__theme").prefetch_related("project__tags").order_by("-updated_at")[:100]
    sponsors = SponsorIntent.objects.filter(user=user).select_related("project", "project__theme").prefetch_related("project__tags").order_by("-updated_at")[:100]
    scores = ProjectScore.objects.filter(user=user).select_related("project", "project__theme").prefetch_related("project__tags").order_by("-updated_at")[:100]
    tasks = ProjectTask.objects.filter(assignee=user).select_related("project", "project__theme", "assignee").prefetch_related("project__tags").order_by("-updated_at")[:100]
    contributions = (
        Contribution.objects.filter(user=user)
        .select_related("user", "project", "project__theme", "task", "task__project", "reviewer")
        .prefetch_related("project__tags", "task__project__tags")
        .order_by("-created_at")[:100]
    )
    credits = (
        CreditLedger.objects.filter(user=user)
        .select_related("user", "project", "project__theme", "task", "task__project", "created_by")
        .prefetch_related("project__tags", "task__project__tags")
        .order_by("-created_at")[:100]
    )
    return ok(admin_user_detail_payload(user, follows, interests, claims, sponsors, scores, tasks, contributions, credits))


@api.get("/admin/interactions/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_interaction_list(
    request,
    type: str = "",
    status: str = "",
    project: str = "",
    theme: str = "",
    user: str = "",
    q: str = "",
    page: int = 1,
    page_size: int = 50,
):
    auth_error = require_capability(request, "review_interactions")
    if auth_error:
        return auth_error
    rows = []
    for kind in interaction_kinds(type):
        query = interaction_queryset(kind)
        if status:
            query = query.filter(status=status)
        if project:
            query = query.filter(related_project_search_q(project))
        if theme:
            query = query.filter(Q(project__theme__slug=theme) | Q(project__theme__name=theme))
        if user:
            query = query.filter(Q(user__username__icontains=user) | Q(user__profile__uid__icontains=user) | Q(user__email__icontains=user))
        if q:
            query = query.filter(
                related_project_search_q(q)
                | Q(user__username__icontains=q)
                | Q(user__profile__uid__icontains=q)
            )
        rows.extend(interaction_payload(kind, item) for item in ordered_review_interactions(query))

    def interaction_list_sort_key(item):
        status_rank = 0 if item.get("status") == InteractionStatus.PENDING else 1
        created_at = item.get("created_at")
        updated_at = item.get("updated_at")
        created_ts = created_at.timestamp() if hasattr(created_at, "timestamp") else 0
        updated_ts = updated_at.timestamp() if hasattr(updated_at, "timestamp") else 0
        return (status_rank, created_ts if status_rank == 0 else -updated_ts)

    rows.sort(key=interaction_list_sort_key)
    return ok(paginated_list(rows, page, page_size))


def ordered_review_interactions(query, limit=500):
    pending_items = list(query.filter(status=InteractionStatus.PENDING).order_by("created_at", "pk")[:limit])
    remaining = max(0, limit - len(pending_items))
    if not remaining:
        return pending_items
    processed_items = list(query.exclude(status=InteractionStatus.PENDING).order_by("-updated_at", "-pk")[:remaining])
    return pending_items + processed_items


@api.patch(
    "/admin/interactions/{type}/{interaction_id}/status/",
    response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 409: ErrorEnvelope, 422: ErrorEnvelope},
    tags=["Admin"],
)
def admin_interaction_update_status(request, type: str, interaction_id: int, payload: InteractionStatusRequest):
    auth_error = require_capability(request, "review_interactions")
    if auth_error:
        return auth_error
    if type not in {"claim", "sponsor"}:
        return audit_failed_response(
            request.user,
            "interaction.review",
            "Interaction",
            interaction_id,
            fail("管理员只审批认领和资助意向。", status=422, code="invalid_interaction_type"),
        )
    review_note = (payload.review_note or "").strip()
    if payload.status not in REVIEWABLE_INTERACTION_STATUSES:
        return audit_failed_response(
            request.user,
            "interaction.review",
            interaction_model(type).__name__,
            interaction_id,
            fail("审核状态不合法。", status=422, code="validation_error"),
        )
    with transaction.atomic():
        item = get_interaction_or_404(type, interaction_id)
        item = item.__class__.objects.select_for_update().select_related("user", "user__profile", "project", "project__theme").get(pk=item.pk)
        if type == "claim" and item.claim_type not in REVIEW_REQUIRED_CLAIM_TYPES:
            return audit_failed_response(
                request.user,
                "interaction.review",
                item.__class__.__name__,
                item.pk,
                fail("该认领类型不需要管理员审核。", status=422, code="invalid_interaction_type"),
            )
        project = Project.objects.select_for_update().get(pk=item.project_id)
        before = interaction_payload(type, item)
        if item.status != InteractionStatus.PENDING:
            return audit_failed_response(
                request.user,
                "interaction.review",
                item.__class__.__name__,
                item.pk,
                fail("只有待处理申请可以审核。", status=422, code="interaction_not_pending"),
                before=before,
            )
        if payload.status == InteractionStatus.REJECTED and not review_note:
            return audit_failed_response(
                request.user,
                "interaction.review",
                item.__class__.__name__,
                item.pk,
                fail(
                    "拒绝申请时必须填写审核意见。",
                    status=422,
                    code="review_note_required",
                    errors={"review_note": ["拒绝申请时必须填写审核意见。"]},
                ),
                before=before,
            )
        if type == "claim" and payload.status == InteractionStatus.APPROVED and item.claim_type in REVIEW_REQUIRED_CLAIM_TYPES:
            active_claims = active_claim_slot_queryset(project, item.claim_type).select_for_update().exclude(pk=item.pk)
            if active_claims.count() > 1:
                return audit_failed_response(
                    request.user,
                    "interaction.review",
                    item.__class__.__name__,
                    item.pk,
                    fail("该课题认领数据存在冲突，请联系管理员处理。", status=422, code="claim_data_conflict"),
                    before=before,
                )
            if active_claims.exists():
                audit(request.user, "interaction.review", item.__class__.__name__, item.pk, status="failed", error_code="claim_slot_occupied", error_message="该认领席位已被占用，暂不能通过重复认领。")
                return fail("该认领席位已被占用，暂不能通过重复认领。", status=409, code="claim_slot_occupied")
        previous_project_stage = project.stage
        item.status = payload.status
        update_fields = ["status", "updated_at"]
        if type in {"claim", "sponsor"}:
            item.review_comment = review_note
            item.reviewed_by = request.user
            item.reviewed_at = timezone.now()
            update_fields.extend(["review_comment", "reviewed_by", "reviewed_at"])
        item.save(update_fields=update_fields)
        if type == "claim" and item.status == InteractionStatus.APPROVED:
            maybe_advance_project_stage_after_interaction(project, request.user)
        item.project.refresh_from_db()
        after = interaction_payload(type, item)
        audit(
            request.user,
            "interaction.review",
            item.__class__.__name__,
            item.pk,
            before=before,
            after={**after, "review_note": review_note, "previous_project_stage": previous_project_stage},
        )
    return ok(after)


@api.patch("/me/interactions/{type}/{interaction_id}/withdraw/", response={200: Envelope, 401: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Me"])
def me_interaction_withdraw(request, type: str, interaction_id: int, payload: InteractionWithdrawRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    with transaction.atomic():
        item = get_object_or_404(
            interaction_queryset(type).select_for_update().filter(user=request.user),
            pk=interaction_id,
        )
        before = interaction_payload(type, item)
        if type == "claim" and getattr(item, "claim_type", "") in REVIEW_REQUIRED_CLAIM_TYPES:
            if item.status == InteractionStatus.PENDING:
                audit(
                    request.user,
                    "interaction.withdraw",
                    item.__class__.__name__,
                    item.pk,
                    before=before,
                    status="failed",
                    error_code="claim_pending_cannot_withdraw",
                    error_message="认领正在审批中，审批通过后才可撤回。",
                )
                return fail("认领正在审批中，审批通过后才可撤回。", status=422, code="claim_pending_cannot_withdraw")
            if item.status != InteractionStatus.APPROVED:
                audit(
                    request.user,
                    "interaction.withdraw",
                    item.__class__.__name__,
                    item.pk,
                    before=before,
                    status="failed",
                    error_code="interaction_not_withdrawable",
                    error_message="当前认领状态不可撤回。",
                )
                return fail("当前认领状态不可撤回。", status=422, code="interaction_not_withdrawable")
        item.status = InteractionStatus.WITHDRAWN
        item.save(update_fields=["status", "updated_at"])
        after = interaction_payload(type, item)
        audit(request.user, "interaction.withdraw", item.__class__.__name__, item.pk, before=before, after={**after, "reason": payload.reason or ""})
    return ok(after)


@api.get("/me/tasks/", response={200: Envelope, 401: ErrorEnvelope}, tags=["Me"])
def me_task_list(request, status: str = "", page: int = 1, page_size: int = 50):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    tasks = ProjectTask.objects.filter(assignee=request.user).select_related("project", "project__theme", "assignee").prefetch_related("project__tags").order_by("-updated_at")
    if status:
        tasks = tasks.filter(status=status)
    return ok(paginated_queryset(tasks, page, page_size, task_payload, max_page_size=100))


@api.patch("/me/tasks/{task_id}/status/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Me"])
def me_task_update_status(request, task_id: int, payload: TaskStatusRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    task = get_object_or_404(ProjectTask.objects.select_related("project", "project__theme", "assignee"), pk=task_id, assignee=request.user)
    if payload.status not in {ProjectTask.TaskStatus.CLAIMED, ProjectTask.TaskStatus.IN_PROGRESS, ProjectTask.TaskStatus.REVIEW}:
        return fail("Invalid task status for assignee.", status=422, code="validation_error")
    before = task_payload(task)
    task.status = payload.status
    task.save(update_fields=["status", "updated_at"])
    audit(request.user, "task.user_status", "ProjectTask", task.pk, before=before, after=task_payload(task))
    return ok(task_payload(task))


@api.get("/me/contributions/", response={200: Envelope, 401: ErrorEnvelope}, tags=["Me"])
def me_contribution_list(request, status: str = "", page: int = 1, page_size: int = 50):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    contributions = (
        Contribution.objects.filter(user=request.user)
        .select_related("user", "project", "project__theme", "task", "task__project", "reviewer")
        .prefetch_related("project__tags", "task__project__tags")
        .order_by("-created_at")
    )
    if status:
        contributions = contributions.filter(status=status)
    return ok(paginated_queryset(contributions, page, page_size, contribution_payload, max_page_size=100))


@api.post("/me/contributions/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Me"])
def me_contribution_create(request, payload: ContributionWriteRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    context, error = contribution_submission_context(
        request,
        project_id=payload.project_id,
        title=payload.title,
        result_type=payload.result_type,
        task_id=payload.task_id,
    )
    if error:
        return error
    contribution = create_contribution_submission(
        request,
        context,
        description=payload.description or "",
        file_path=payload.file_path or "",
    )
    return 201, ok(contribution_payload(contribution))


@api.post("/me/contributions/upload/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Me"])
def me_contribution_upload(request):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    context, error = contribution_submission_context(
        request,
        project_id=request.POST.get("project_id"),
        title=request.POST.get("title"),
        result_type=request.POST.get("result_type"),
        task_id=request.POST.get("task_id"),
    )
    if error:
        return error
    files = request.FILES.getlist("file")
    if not files:
        return fail("No result document uploaded.", status=422, code="validation_error")
    if len(files) != 1:
        return fail("Only one result document can be uploaded at a time.", status=422, code="validation_error")
    file_path, content_hash, error = save_contribution_document(files[0], context["project"], request.user)
    if error:
        return audit_failed_response(request.user, "contribution.submit", "Project", context["project"].id, error)
    contribution = create_contribution_submission(
        request,
        context,
        description=request.POST.get("description") or "",
        file_path=file_path,
        after_extra={"document_hash": content_hash},
    )
    return 201, ok(contribution_payload(contribution))


@api.get("/me/credits/", response={200: Envelope, 401: ErrorEnvelope}, tags=["Me"])
def me_credit_list(request, page: int = 1, page_size: int = 50):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    entries = (
        CreditLedger.objects.filter(user=request.user)
        .select_related("user", "project", "project__theme", "task", "task__project", "created_by")
        .prefetch_related("project__tags", "task__project__tags")
        .order_by("-created_at")
    )
    return ok(paginated_queryset(entries, page, page_size, credit_ledger_payload, max_page_size=100))


@api.post("/me/credits/transfer/", response={200: Envelope, 401: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Me"])
def me_credit_transfer(request, payload: CreditTransferRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    target_uid = str(payload.target_uid or "").strip()
    amount = int(payload.amount or 0)
    reason = str(payload.reason or "").strip()[:200]
    if not target_uid:
        return fail("请输入接收人的 UID。", status=422, code="validation_error")
    if amount < 1 or amount > CREDIT_TRANSFER_MAX_AMOUNT:
        return fail("单次转赠积分需在 1 到 50 之间。", status=422, code="validation_error")
    if target_uid == request.user.profile.uid:
        return fail("不能给自己转赠积分。", status=422, code="validation_error")
    with transaction.atomic():
        source_profile = UserProfile.objects.select_for_update().select_related("user").get(user=request.user)
        target_profile = get_object_or_404(
            UserProfile.objects.select_for_update().select_related("user"),
            uid=target_uid,
            user__is_active=True,
        )
        reserved_amount = len(reserved_participation_project_ids(request.user)) * PROJECT_PARTICIPATION_CREDIT_COST
        if source_profile.credit_balance - reserved_amount < amount:
            return fail("当前可用积分不足，无法转赠。", status=422, code="insufficient_credits")
        source_profile.credit_balance -= amount
        target_profile.credit_balance += amount
        source_profile.save(update_fields=["credit_balance", "updated_at"])
        target_profile.save(update_fields=["credit_balance", "updated_at"])
        source_entry = CreditLedger.objects.create(
            user=source_profile.user,
            action_type=CreditLedger.ActionType.TRANSFER,
            amount=-amount,
            balance_after=source_profile.credit_balance,
            reason=reason or f"转赠给 {target_profile.uid}",
            created_by=request.user,
        )
        target_entry = CreditLedger.objects.create(
            user=target_profile.user,
            action_type=CreditLedger.ActionType.TRANSFER,
            amount=amount,
            balance_after=target_profile.credit_balance,
            reason=reason or f"收到 {source_profile.uid} 转赠",
            created_by=request.user,
        )
    request.user.profile.refresh_from_db()
    audit(request.user, "credit.transfer_send", "CreditLedger", source_entry.pk, after=credit_ledger_payload(source_entry))
    audit(request.user, "credit.transfer_receive", "CreditLedger", target_entry.pk, after=credit_ledger_payload(target_entry))
    return ok(
        {
            "balance": request.user.profile.credit_balance,
            "sent": credit_ledger_payload(source_entry),
            "received": credit_ledger_payload(target_entry),
        }
    )


@api.get("/admin/tasks/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_task_list(request, project: str = "", status: str = "", assignee: str = "", q: str = "", page: int = 1, page_size: int = 50):
    auth_error = require_capability(request, "manage_tasks")
    if auth_error:
        return auth_error
    tasks = ProjectTask.objects.select_related("project", "project__theme", "assignee").prefetch_related("project__tags").order_by("-updated_at")
    if project:
        tasks = tasks.filter(related_project_search_q(project))
    if status:
        tasks = tasks.filter(status=status)
    if assignee:
        tasks = tasks.filter(Q(assignee__profile__uid__icontains=assignee) | Q(assignee__username__icontains=assignee))
    if q:
        tasks = tasks.filter(Q(title__icontains=q) | Q(description__icontains=q) | related_project_search_q(q))
    return ok(paginated_queryset(tasks, page, page_size, task_payload, max_page_size=100))


@api.post("/admin/tasks/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_task_create(request, payload: TaskWriteRequest):
    auth_error = require_capability(request, "manage_tasks")
    if auth_error:
        return auth_error
    title = payload.title.strip()
    if not title:
        return fail("Task title is required.", status=422, code="validation_error")
    project = get_object_or_404(Project, pk=payload.project_id)
    assignee = user_from_uid(payload.assignee_uid) if payload.assignee_uid else None
    status = payload.status or (ProjectTask.TaskStatus.CLAIMED if assignee else ProjectTask.TaskStatus.TODO)
    if status not in ProjectTask.TaskStatus.values:
        return fail("Invalid task status.", status=422, code="validation_error")
    task = ProjectTask.objects.create(
        project=project,
        title=title,
        description=payload.description or "",
        task_type=payload.task_type or "",
        required_role=payload.required_role or "",
        difficulty=max(1, min(int(payload.difficulty or 1), 5)),
        status=status,
        assignee=assignee,
        deadline=payload.deadline,
        credit_deposit=int(payload.credit_deposit or 0),
        credit_reward=int(payload.credit_reward or 0),
    )
    audit(request.user, "task.create", "ProjectTask", task.pk, after=task_payload(task))
    return 201, ok(task_payload(task))


@api.get("/admin/tasks/{task_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Admin"])
def admin_task_get(request, task_id: int):
    auth_error = require_capability(request, "manage_tasks")
    if auth_error:
        return auth_error
    task = get_object_or_404(ProjectTask.objects.select_related("project", "project__theme", "assignee").prefetch_related("project__tags"), pk=task_id)
    return ok(task_payload(task))


@api.patch("/admin/tasks/{task_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_task_update(request, task_id: int, payload: TaskPatchRequest):
    auth_error = require_capability(request, "manage_tasks")
    if auth_error:
        return auth_error
    task = get_object_or_404(ProjectTask.objects.select_related("project", "project__theme", "assignee"), pk=task_id)
    before = task_payload(task)
    data = payload.model_dump(exclude_unset=True)
    if "project_id" in data and data["project_id"]:
        task.project = get_object_or_404(Project, pk=data["project_id"])
    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            return fail("Task title is required.", status=422, code="validation_error")
        task.title = title
    for field in ["description", "task_type", "required_role", "deadline"]:
        if field in data:
            setattr(task, field, data[field] or (None if field == "deadline" else ""))
    if "difficulty" in data and data["difficulty"] is not None:
        task.difficulty = max(1, min(int(data["difficulty"]), 5))
    if "status" in data and data["status"]:
        if data["status"] not in ProjectTask.TaskStatus.values:
            return fail("Invalid task status.", status=422, code="validation_error")
        task.status = data["status"]
    if "assignee_uid" in data:
        task.assignee = user_from_uid(data["assignee_uid"]) if data["assignee_uid"] else None
    for field in ["credit_deposit", "credit_reward"]:
        if field in data and data[field] is not None:
            setattr(task, field, int(data[field]))
    task.save()
    audit(request.user, "task.update", "ProjectTask", task.pk, before=before, after=task_payload(task))
    return ok(task_payload(task))


@api.delete("/admin/tasks/{task_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Admin"])
def admin_task_delete(request, task_id: int):
    auth_error = require_capability(request, "manage_tasks")
    if auth_error:
        return auth_error
    task = get_object_or_404(ProjectTask.objects.select_related("project", "project__theme", "assignee"), pk=task_id)
    before = task_payload(task)
    task.status = ProjectTask.TaskStatus.CANCELLED
    task.save(update_fields=["status", "updated_at"])
    audit(request.user, "task.cancel", "ProjectTask", task.pk, before=before, after=task_payload(task))
    return ok(task_payload(task))


@api.post("/admin/tasks/{task_id}/assign/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Admin"])
def admin_task_assign(request, task_id: int, payload: TaskAssignRequest):
    auth_error = require_capability(request, "manage_tasks")
    if auth_error:
        return auth_error
    task = get_object_or_404(ProjectTask.objects.select_related("project", "project__theme", "assignee"), pk=task_id)
    assignee = user_from_uid(payload.uid)
    before = task_payload(task)
    task.assignee = assignee
    task.status = ProjectTask.TaskStatus.CLAIMED
    task.save(update_fields=["assignee", "status", "updated_at"])
    audit(request.user, "task.assign", "ProjectTask", task.pk, before=before, after=task_payload(task))
    return ok(task_payload(task))


@api.patch("/admin/tasks/{task_id}/status/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_task_status(request, task_id: int, payload: TaskStatusRequest):
    auth_error = require_capability(request, "manage_tasks")
    if auth_error:
        return auth_error
    if payload.status not in ProjectTask.TaskStatus.values:
        return fail("Invalid task status.", status=422, code="validation_error")
    task = get_object_or_404(ProjectTask.objects.select_related("project", "project__theme", "assignee"), pk=task_id)
    before = task_payload(task)
    task.status = payload.status
    task.save(update_fields=["status", "updated_at"])
    audit(request.user, "task.status", "ProjectTask", task.pk, before=before, after=task_payload(task))
    return ok(task_payload(task))


@api.get("/admin/contributions/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_contribution_list(request, status: str = "", project: str = "", task: str = "", user: str = "", page: int = 1, page_size: int = 50):
    auth_error = require_capability(request, "review_contributions")
    if auth_error:
        return auth_error
    contributions = (
        Contribution.objects.select_related("user", "project", "project__theme", "task", "task__project", "reviewer")
        .prefetch_related("project__tags", "task__project__tags")
        .order_by("-created_at")
    )
    if status:
        contributions = contributions.filter(status=status)
    if project:
        contributions = contributions.filter(related_project_search_q(project))
    if task:
        task_filter = Q(task__title__icontains=task)
        if str(task).isdigit():
            task_filter |= Q(task_id=int(task))
        contributions = contributions.filter(task_filter)
    if user:
        contributions = contributions.filter(Q(user__profile__uid__icontains=user) | Q(user__username__icontains=user) | Q(user__email__icontains=user))
    return ok(paginated_queryset(contributions, page, page_size, contribution_payload, max_page_size=100))


@api.get("/admin/contributions/{contribution_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Admin"])
def admin_contribution_get(request, contribution_id: int):
    auth_error = require_capability(request, "review_contributions")
    if auth_error:
        return auth_error
    contribution = get_object_or_404(
        Contribution.objects.select_related("user", "project", "project__theme", "task", "task__project", "reviewer").prefetch_related("project__tags", "task__project__tags"),
        pk=contribution_id,
    )
    return ok(contribution_payload(contribution))


@api.patch("/admin/contributions/{contribution_id}/review/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_contribution_review(request, contribution_id: int, payload: ContributionReviewRequest):
    auth_error = require_capability(request, "review_contributions")
    if auth_error:
        return auth_error
    if payload.status not in REVIEWABLE_CONTRIBUTION_STATUSES:
        return fail("Invalid contribution status.", status=422, code="validation_error")
    with transaction.atomic():
        contribution = get_object_or_404(
            Contribution.objects.select_for_update()
            .select_related("user", "user__profile", "project", "project__theme", "task", "task__project", "reviewer")
            .prefetch_related("project__tags", "task__project__tags"),
            pk=contribution_id,
        )
        before = contribution_payload(contribution)
        contribution.status = payload.status
        contribution.review_comment = payload.review_comment or ""
        contribution.reviewer = request.user
        contribution.reviewed_at = timezone.now()
        contribution.save(update_fields=["status", "review_comment", "reviewer", "reviewed_at"])
        reward_granted = grant_task_reward_once(contribution, request.user) if payload.status == ContributionStatus.APPROVED and payload.grant_reward else False
        if contribution.task:
            update_task_after_contribution_review(contribution.task, payload.status)
        after = contribution_payload(contribution)
        audit(
            request.user,
            "contribution.review",
            "Contribution",
            contribution.pk,
            before=before,
            after={**after, "grant_reward": payload.grant_reward, "reward_granted": reward_granted},
        )
    return ok(contribution_payload(contribution))


@api.get("/admin/credits/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_credit_list(request, uid: str = "", action_type: str = "", project: str = "", page: int = 1, page_size: int = 50):
    auth_error = require_capability(request, "manage_credits")
    if auth_error:
        return auth_error
    entries = (
        CreditLedger.objects.select_related("user", "project", "project__theme", "task", "task__project", "created_by")
        .prefetch_related("project__tags", "task__project__tags")
        .order_by("-created_at")
    )
    if uid:
        entries = entries.filter(user__profile__uid=uid)
    if action_type:
        entries = entries.filter(action_type=action_type)
    if project:
        entries = entries.filter(related_project_search_q(project))
    return ok(paginated_queryset(entries, page, page_size, credit_ledger_payload, max_page_size=100))


@api.get("/admin/audit-logs/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_audit_log_list(request, actor: str = "", action: str = "", target_type: str = "", target_id: str = "", page: int = 1, page_size: int = 50):
    auth_error = require_capability(request, "view_audit_logs")
    if auth_error:
        return auth_error
    entries = AuditLog.objects.select_related("actor").order_by("-created_at")
    if actor:
        entries = entries.filter(Q(actor__username__icontains=actor) | Q(actor__profile__uid__icontains=actor))
    if action:
        entries = entries.filter(action__icontains=action)
    if target_type:
        entries = entries.filter(target_type__icontains=target_type)
    if target_id:
        entries = entries.filter(target_id=str(target_id))
    return ok(paginated_queryset(entries, page, page_size, audit_log_payload, max_page_size=100))


@api.get("/admin/project-discussions/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_project_discussion_list(request, project_id: Optional[int] = None, author_uid: str = "", status: str = "", page: int = 1, page_size: int = 50):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    discussions = ProjectDiscussion.objects.select_related("project", "author", "author__profile", "parent").order_by("-created_at", "-id")
    if project_id:
        discussions = discussions.filter(project_id=project_id)
    if author_uid.strip():
        discussions = discussions.filter(author__profile__uid__icontains=author_uid.strip())
    if status.strip():
        discussions = discussions.filter(status=status.strip())
    return ok(paginated_queryset(discussions, page, page_size, discussion_payload, max_page_size=100))


@api.patch("/admin/project-discussions/{discussion_id}/moderation/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_project_discussion_moderate(request, discussion_id: int, payload: ProjectDiscussionModerationRequest):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    discussion = get_object_or_404(ProjectDiscussion.objects.select_related("project", "author", "author__profile"), pk=discussion_id)
    status = str(payload.status or "").strip()
    if status not in ProjectDiscussion.Status.values:
        return fail("Discussion status is invalid.", status=422, code="validation_error")
    before = discussion_audit_snapshot(discussion)
    discussion.status = status
    discussion.moderation_reason = str(payload.moderation_reason or "").strip()
    if status == ProjectDiscussion.Status.HIDDEN:
        discussion.hidden_at = timezone.now()
        discussion.hidden_by = request.user
    elif status == ProjectDiscussion.Status.DELETED:
        discussion.deleted_at = timezone.now()
        discussion.deleted_by = request.user
    elif status == ProjectDiscussion.Status.VISIBLE:
        discussion.hidden_at = None
        discussion.hidden_by = None
    discussion.save(update_fields=["status", "moderation_reason", "hidden_at", "hidden_by", "deleted_at", "deleted_by", "updated_at"])
    audit(request.user, "project_discussion.moderate", "ProjectDiscussion", discussion.id, before=before, after=discussion_audit_snapshot(discussion))
    return ok(discussion_payload(discussion))


@api.post(
    "/admin/sidebar-qrs/{key}/image/",
    response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope},
    tags=["Admin"],
)
def admin_sidebar_qr_upload(request, key: str):
    auth_error = require_capability(request, "view_admin_console")
    if auth_error:
        return auth_error
    definition = sidebar_qr_definition(key)
    if not definition:
        raise Http404("Sidebar QR entry not found.")
    files = request.FILES.getlist("file")
    if not files:
        return fail("No QR image uploaded.", status=422, code="validation_error")
    if len(files) != 1:
        return fail("Only one QR image can be uploaded at a time.", status=422, code="validation_error")
    uploaded = files[0]
    suffix = Path(sanitize_file_name(uploaded.name)).suffix.lower()
    if suffix not in SIDEBAR_QR_EXTENSIONS:
        return fail("二维码只支持 PNG、JPG 或 WebP 图片。", status=422, code="validation_error")
    if getattr(uploaded, "size", 0) > SIDEBAR_QR_MAX_BYTES:
        return fail("二维码图片不能超过 2MB。", status=422, code="validation_error")
    if uploaded.content_type and not str(uploaded.content_type).lower().startswith("image/"):
        return fail("二维码只支持图片文件。", status=422, code="validation_error")
    if not uploaded_file_has_allowed_image_signature(uploaded, suffix):
        return fail("二维码图片格式无法识别。", status=422, code="validation_error")
    root = sidebar_qr_root()
    root.mkdir(parents=True, exist_ok=True)
    destination = safe_child_path(root, f"{key}{suffix}", root, expect_parent=True)
    before = sidebar_qr_entry_payload(definition)
    for old_file in sidebar_qr_files_for_key(key):
        if old_file != destination and old_file.is_file():
            old_file.unlink()
    content_hash = write_uploaded_file_with_hash(uploaded, destination)
    after = sidebar_qr_entry_payload(definition)
    audit(request.user, "platform_qr.upload", "PlatformQRCode", key, before=before, after={**after, "content_hash": content_hash})
    return 201, ok({"entry": after})


@api.get("/admin/themes/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_theme_list(request):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    themes = Theme.objects.order_by("sort_order", "name")
    return ok({"results": [theme_payload(theme) for theme in themes]})


@api.patch("/admin/themes/reorder/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_theme_reorder(request, payload: ThemeReorderRequest):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    theme_ids = [int(item) for item in payload.theme_ids or []]
    if not theme_ids:
        return fail("theme_ids is required.", status=422, code="validation_error")
    if len(set(theme_ids)) != len(theme_ids):
        return fail("theme_ids must be unique.", status=422, code="validation_error")
    themes_by_id = {theme.id: theme for theme in Theme.objects.filter(id__in=theme_ids)}
    if set(themes_by_id) != set(theme_ids):
        return fail("Theme ids contain unknown items.", status=422, code="validation_error")
    before = {str(theme.id): theme.sort_order for theme in Theme.objects.filter(id__in=theme_ids)}
    with transaction.atomic():
        for index, theme_id in enumerate(theme_ids, start=1):
            theme = themes_by_id[theme_id]
            theme.sort_order = index * 10
            theme.save(update_fields=["sort_order", "updated_at"])
    reordered = list(Theme.objects.filter(id__in=theme_ids).order_by("sort_order", "name"))
    after = {str(theme.id): theme.sort_order for theme in reordered}
    audit(request.user, "theme.reorder", "Theme", "bulk", before={"order": before}, after={"order": after})
    return ok({"themes": [theme_payload(theme) for theme in reordered]})


@api.post("/admin/themes/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_theme_create(request, payload: ThemeWriteRequest):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    name = (data.get("name") or "").strip()
    if not name:
        return fail("Theme name is required.", status=422, code="validation_error")
    slug = data.get("slug") or unique_slug(Theme, name)
    if Theme.objects.filter(slug=slug).exists():
        return fail("Theme slug already exists.", status=422, code="validation_error")
    theme = Theme.objects.create(
        name=name,
        slug=slug,
        description=data.get("description", ""),
        cover_image=data.get("cover_image", ""),
        sort_order=data.get("sort_order", 0),
        is_active=data.get("is_active", True),
    )
    audit(request.user, "theme.create", "Theme", theme.id, after=theme_payload(theme))
    return 201, ok(theme_payload(theme))


@api.patch("/admin/themes/{theme_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_theme_update(request, theme_id: int, payload: ThemeWriteRequest):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    theme = get_object_or_404(Theme, pk=theme_id)
    before = theme_payload(theme)
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "name" in data and data["name"]:
        theme.name = data["name"].strip()
    if "slug" in data and data["slug"]:
        slug = data["slug"].strip()
        if Theme.objects.filter(slug=slug).exclude(pk=theme.pk).exists():
            return fail("Theme slug already exists.", status=422, code="validation_error")
        theme.slug = slug
    elif "name" in data and not theme.slug:
        theme.slug = slugify(theme.name, allow_unicode=True) or unique_slug(Theme, theme.name)
    for field in ["description", "cover_image", "sort_order", "is_active"]:
        if field in data:
            setattr(theme, field, data[field])
    theme.save()
    audit(request.user, "theme.update", "Theme", theme.id, before=before, after=theme_payload(theme))
    return ok(theme_payload(theme))


@api.delete("/admin/themes/{theme_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Admin"])
def admin_theme_delete(request, theme_id: int):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    theme = get_object_or_404(Theme, pk=theme_id)
    before = theme_payload(theme)
    detail_pdf_paths = list(theme.files.exclude(detail_pdf_path="").values_list("detail_pdf_path", flat=True))
    with transaction.atomic():
        theme.delete()
        audit(request.user, "theme.delete", "Theme", theme_id, before=before, after={"id": theme_id, "deleted": True})
    for path in detail_pdf_paths:
        maybe_delete_managed_theme_file_detail_pdf(path)
    return ok({"id": theme_id, "deleted": True})


@api.get("/admin/theme-files/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_theme_file_list(request, theme: str = "", theme_id: Optional[int] = None, active: str = "", page: int = 1, page_size: int = 100):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    files = ThemeFile.objects.select_related("theme").order_by("theme__sort_order", "theme__name", "sort_order", "section", "title")
    if theme_id:
        files = files.filter(theme_id=theme_id)
    elif theme.strip():
        theme_value = theme.strip()
        files = files.filter(Q(theme__slug=theme_value) | Q(theme__name=theme_value))
    if active in {"1", "true", "yes"}:
        files = files.filter(is_active=True)
    elif active in {"0", "false", "no"}:
        files = files.filter(is_active=False)
    page_size = max(1, min(page_size, 500))
    paginator = Paginator(files, page_size)
    page_obj = paginator.get_page(page)
    return ok(
        {
            "results": [theme_file_payload(file) for file in page_obj.object_list],
            "pagination": {
                "page": page_obj.number,
                "page_size": page_size,
                "total_pages": paginator.num_pages,
                "total_count": paginator.count,
                "has_next": page_obj.has_next(),
                "has_previous": page_obj.has_previous(),
            },
        }
    )


@api.post("/admin/theme-files/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_theme_file_create(request, payload: ThemeFileWriteRequest):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    theme = theme_from_payload(data)
    if not theme:
        return fail("Theme is required.", status=422, code="validation_error")
    title = (data.get("title") or "").strip()
    path = (data.get("path") or "").strip()
    if not title:
        return fail("title is required.", status=422, code="validation_error")
    if ThemeFile.objects.filter(theme=theme, is_active=True).exists():
        return fail("Each theme can only have one active dataset description.", status=422, code="validation_error")
    if not path:
        path = unique_dataset_description_path(theme, title)
    if ThemeFile.objects.filter(theme=theme, path=path).exists():
        return fail("Dataset description already exists.", status=422, code="validation_error")
    file = ThemeFile.objects.create(
        theme=theme,
        section=(data.get("section") or "数据集说明文件").strip(),
        file_type=normalize_theme_file_type(data.get("file_type") or ThemeFile.FileType.DATASET_META),
        title=title,
        description=data.get("description", ""),
        path=path,
        detail_pdf_title=str(data.get("detail_pdf_title") or "").strip()[:255],
        detail_pdf_path=public_document_path_for_admin(data.get("detail_pdf_path") or ""),
        sort_order=data.get("sort_order", 0),
        is_active=data.get("is_active", True),
    )
    audit(request.user, "theme_file.create", "ThemeFile", file.id, after=theme_file_payload(file))
    return 201, ok(theme_file_payload(file))


@api.patch("/admin/theme-files/{file_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_theme_file_update(request, file_id: int, payload: ThemeFileWriteRequest):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    file = get_object_or_404(ThemeFile.objects.select_related("theme"), pk=file_id)
    before = theme_file_payload(file)
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    theme = theme_from_payload(data, current=file.theme)
    if theme:
        file.theme = theme
    target_is_active = data.get("is_active", file.is_active)
    if target_is_active and ThemeFile.objects.filter(theme=file.theme, is_active=True).exclude(pk=file.pk).exists():
        return fail("Each theme can only have one active dataset description.", status=422, code="validation_error")
    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            return fail("title is required.", status=422, code="validation_error")
        file.title = title
    if "path" in data:
        path = (data.get("path") or "").strip()
        if not path:
            path = unique_dataset_description_path(file.theme, file.title or "dataset")
        if ThemeFile.objects.filter(theme=file.theme, path=path).exclude(pk=file.pk).exists():
            return fail("Dataset description already exists.", status=422, code="validation_error")
        file.path = path
    for field in ["section", "description", "sort_order", "is_active"]:
        if field in data:
            setattr(file, field, data[field])
    if "detail_pdf_title" in data:
        file.detail_pdf_title = str(data.get("detail_pdf_title") or "").strip()[:255]
    if "detail_pdf_path" in data:
        path = public_document_path_for_admin(data.get("detail_pdf_path") or "")
        if data.get("detail_pdf_path") and not path:
            return fail("detail_pdf_path is invalid.", status=422, code="validation_error")
        file.detail_pdf_path = path
    if "file_type" in data:
        file.file_type = normalize_theme_file_type(data.get("file_type"))
    file.save()
    audit(request.user, "theme_file.update", "ThemeFile", file.id, before=before, after=theme_file_payload(file))
    return ok(theme_file_payload(file))


@api.post(
    "/admin/theme-files/{file_id}/detail-pdf/",
    response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope},
    tags=["Admin"],
)
def admin_theme_file_detail_pdf_upload(request, file_id: int):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    file = get_object_or_404(ThemeFile.objects.select_related("theme"), pk=file_id)
    uploaded = request.FILES.get("file")
    if not uploaded:
        return fail("No file uploaded.", status=422, code="validation_error")
    file_name, validation_error = validate_uploaded_pdf(uploaded)
    if validation_error:
        return audit_failed_response(request.user, "theme_file.detail_pdf_upload", "ThemeFile", file.id, validation_error)
    title = (request.POST.get("title") or Path(file_name).stem or "数据集说明").strip()[:255]
    root = theme_file_detail_pdf_root()
    directory = safe_child_path(root, f"{file.theme.slug}/{file.pk}", root, expect_parent=False)
    directory.mkdir(parents=True, exist_ok=True)
    destination = unique_theme_file_detail_pdf_destination(directory, file_name)
    before = theme_file_payload(file)
    old_path = file.detail_pdf_path
    content_hash = write_uploaded_file_with_hash(uploaded, destination)
    file.detail_pdf_title = title
    file.detail_pdf_path = public_media_path(destination)
    file.detail_pdf_hash = content_hash
    file.save(update_fields=["detail_pdf_title", "detail_pdf_path", "detail_pdf_hash", "updated_at"])
    maybe_delete_managed_theme_file_detail_pdf(old_path, keep_path=file.detail_pdf_path)
    after = theme_file_payload(file)
    audit(request.user, "theme_file.detail_pdf_upload", "ThemeFile", file.id, before=before, after=after)
    return 201, ok(after)


@api.delete("/admin/theme-files/{file_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Admin"])
def admin_theme_file_delete(request, file_id: int):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    file = get_object_or_404(ThemeFile.objects.select_related("theme"), pk=file_id)
    before = theme_file_payload(file)
    file.is_active = False
    file.save(update_fields=["is_active", "updated_at"])
    audit(request.user, "theme_file.deactivate", "ThemeFile", file.id, before=before, after=theme_file_payload(file))
    return ok(theme_file_payload(file))


@api.get("/admin/content-backup/export/", response={401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_content_backup_export(request):
    auth_error = require_content_backup_capability(request)
    if auth_error:
        return auth_error
    manifest, files = build_content_backup_manifest()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for archive_name, source_path in files.items():
            if source_path.is_file():
                archive.write(source_path, archive_name)
        archive.writestr("openmedailab-backup.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    file_name = f"openmedailab-content-backup-{timezone.localtime().strftime('%Y%m%d-%H%M%S')}.zip"
    audit(request.user, "content_backup.export", "ContentBackup", file_name, after=manifest["counts"])
    response = HttpResponse(buffer.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{file_name}"'
    return response


@api.post("/admin/content-backup/restore/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_content_backup_restore(request):
    auth_error = require_content_backup_capability(request)
    if auth_error:
        return auth_error
    uploaded = request.FILES.get("file")
    if not uploaded:
        return fail("请上传备份 zip 文件。", status=422, code="validation_error")
    if not str(uploaded.name or "").lower().endswith(".zip"):
        return fail("备份文件必须是 zip 格式。", status=422, code="validation_error")
    try:
        result = restore_content_backup(uploaded.read())
    except (ValueError, zipfile.BadZipFile) as exc:
        audit(
            request.user,
            "content_backup.restore",
            "ContentBackup",
            uploaded.name or "backup.zip",
            status="failed",
            error_code="validation_error",
            error_message=str(exc),
        )
        return fail(str(exc), status=422, code="validation_error")
    audit(request.user, "content_backup.restore", "ContentBackup", uploaded.name or "backup.zip", after=result)
    return ok(result)


@api.get("/admin/projects/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_project_list(
    request,
    q: str = "",
    theme: str = "",
    stage: str = "",
    is_public: str = "",
    topic_id: str = "",
    page: int = 1,
    page_size: int = 20,
):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    projects = project_stat_annotations(Project.objects.all().select_related("theme", "created_by", "created_by__profile").prefetch_related("tags", "documents"))
    q = q.strip()
    theme = theme.strip()
    stage = stage.strip()
    is_public = is_public.strip().lower()
    topic_id = topic_id.strip()
    if q:
        projects = projects.filter(project_search_q(q)).distinct()
    if theme:
        projects = projects.filter(Q(theme__slug=theme) | Q(theme__name=theme))
    if stage:
        projects = projects.filter(stage=stage)
    if is_public in {"1", "true", "yes"}:
        projects = projects.filter(is_public=True)
    elif is_public in {"0", "false", "no"}:
        projects = projects.filter(is_public=False)
    if topic_id:
        normalized_topic_id = normalize_project_topic_id(topic_id)
        projects = projects.filter(topic_id=normalized_topic_id) if normalized_topic_id else projects.none()
    projects = projects.order_by("topic_id")
    page_size = max(1, min(page_size, 100))
    paginator = Paginator(projects, page_size)
    page_obj = paginator.get_page(page)
    return ok(
        {
            "results": [admin_project_summary_payload(project) for project in page_obj.object_list],
            "pagination": {
                "page": page_obj.number,
                "page_size": page_size,
                "total_pages": paginator.num_pages,
                "total_count": paginator.count,
                "has_next": page_obj.has_next(),
                "has_previous": page_obj.has_previous(),
            },
        }
    )


@api.post("/admin/projects/import-json/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_project_import_json(request, payload: ProjectBulkImportRequest):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error

    raw_projects = [project.model_dump(exclude_unset=True, exclude_none=True) for project in payload.projects]
    if not raw_projects:
        return fail("projects cannot be empty.", status=422, code="validation_error")

    seen_topic_ids: dict[int, int] = {}
    validated_projects = []
    errors = []
    for index, data in enumerate(raw_projects, start=1):
        if payload.auto_number:
            data.pop("id", None)
            data.pop("topic_id", None)
        normalize_project_identity_alias(data)
        if payload.publish:
            data.setdefault("stage", ProjectStage.OPEN_RECRUITING)
            data.setdefault("is_public", True)
        else:
            data.setdefault("stage", ProjectStage.DRAFT)
            data.setdefault("is_public", False)
        error = validate_admin_project_payload(data, creating=True, allow_create_theme=True)
        if error:
            errors.append({"row": index, "message": error[1]["error"]["message"], "code": error[1]["error"]["code"]})
            continue
        topic_id = data.get("topic_id")
        if topic_id and not payload.auto_number:
            if topic_id in seen_topic_ids:
                errors.append({"row": index, "message": f"id T{topic_id:04d} duplicates row {seen_topic_ids[topic_id]}.", "code": "duplicate_topic_id"})
                continue
            seen_topic_ids[topic_id] = index
        validated_projects.append((index, data))

    if errors:
        return fail("Project import validation failed.", status=422, code="validation_error", errors=errors)

    results = []
    created_count = 0
    updated_count = 0
    current_index = None
    try:
        with transaction.atomic():
            for index, data in validated_projects:
                current_index = index
                project, created = upsert_project_with_instance(data, source_label="api-admin-json-import", allow_create_theme=True, created_by=request.user)
                project = Project.objects.select_related("theme", "created_by", "created_by__profile").prefetch_related("tags", "documents").get(pk=project.pk)
                if created:
                    created_count += 1
                else:
                    updated_count += 1
                results.append({"row": index, "action": "created" if created else "updated", "project": project_detail_payload(project)})
            audit(
                request.user,
                "project.import_json",
                "Project",
                "bulk",
                after={"created_count": created_count, "updated_count": updated_count, "total_count": len(results)},
            )
    except (IntegrityError, ValueError) as exc:
        message = str(exc) or "Project import failed."
        audit(
            request.user,
            "project.import_json",
            "Project",
            "bulk",
            after={"created_count": 0, "updated_count": 0, "total_count": len(validated_projects), "failed_row": current_index},
            status="failed",
            error_code="project_import_failed",
            error_message=message[:500],
        )
        return fail(
            "Project import failed.",
            status=422,
            code="validation_error",
            errors=[{"row": current_index, "message": message, "code": "project_import_failed"}],
        )

    return ok(
        {
            "total_count": len(results),
            "created_count": created_count,
            "updated_count": updated_count,
            "results": results,
        }
    )


@api.post("/admin/projects/bulk-archive/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_project_bulk_archive(request, payload: ProjectBulkArchiveRequest):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    ids = sorted({int(value) for value in payload.ids if int(value) > 0})
    if not ids:
        return fail("ids cannot be empty.", status=422, code="validation_error")
    returned_entries = []
    with transaction.atomic():
        projects = list(Project.objects.filter(id__in=ids).order_by("topic_id"))
        found_ids = {project.id for project in projects}
        missing_ids = [value for value in ids if value not in found_ids]
        before = [{"id": project.id, "topic_id": project.topic_id, "stage": project.stage, "is_public": project.is_public} for project in projects]
        Project.objects.filter(id__in=found_ids).update(stage=ProjectStage.ARCHIVED, is_public=False, updated_at=timezone.now())
        active_project_ids = [project.id for project in projects if project.stage == ProjectStage.ACTIVE]
        for project in Project.objects.select_for_update().filter(id__in=active_project_ids).order_by("topic_id"):
            returned_entries.extend(grant_project_completion_credits_once(project, request.user))
        audit(
            request.user,
            "project.bulk_archive",
            "Project",
            "bulk",
            before={"projects": before},
            after={"archived_count": len(projects), "ids": ids, "missing_ids": missing_ids},
        )
        for entry in returned_entries:
            audit(request.user, "credit.project_completion_return", "CreditLedger", entry.pk, after=credit_ledger_payload(entry))
    return ok({"archived_count": len(projects), "ids": ids, "missing_ids": missing_ids})


@api.post("/admin/projects/bulk-action/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_project_bulk_action(request, payload: ProjectBulkActionRequest):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    try:
        ids = sorted({int(value) for value in payload.ids if int(value) > 0})
    except (TypeError, ValueError):
        return fail("ids must be positive integers.", status=422, code="validation_error")
    if not ids:
        return fail("ids cannot be empty.", status=422, code="validation_error")

    action = str(payload.action or "").strip()
    if action not in {"archive", "delete", "set_public", "set_stage"}:
        return fail("Bulk action is invalid.", status=422, code="validation_error")

    update_fields = {}
    if action == "archive":
        update_fields = {"stage": ProjectStage.ARCHIVED, "is_public": False}
    elif action == "set_public":
        if payload.is_public is None:
            return fail("is_public is required.", status=422, code="validation_error")
        update_fields = {"is_public": bool(payload.is_public)}
    elif action == "set_stage":
        stage = normalize_project_stage_value(payload.stage)
        if stage not in ProjectStage.values:
            return fail("stage is invalid.", status=422, code="validation_error")
        update_fields = {"stage": stage}
        if stage == ProjectStage.ARCHIVED:
            update_fields["is_public"] = False

    document_paths = []
    charged_entries = []
    returned_entries = []
    with transaction.atomic():
        projects = list(Project.objects.filter(id__in=ids).prefetch_related("documents").order_by("topic_id"))
        found_ids = {project.id for project in projects}
        missing_ids = [value for value in ids if value not in found_ids]
        before = [
            {"id": project.id, "topic_id": project.topic_id, "stage": project.stage, "is_public": project.is_public}
            for project in projects
        ]
        if action == "delete":
            document_paths = [document.path for project in projects for document in project.documents.all()]
            Project.objects.filter(id__in=found_ids).delete()
        else:
            Project.objects.filter(id__in=found_ids).update(**update_fields, updated_at=timezone.now())
            if action == "set_stage" and update_fields.get("stage") == ProjectStage.ACTIVE:
                active_project_ids = [
                    project.id
                    for project in projects
                    if project.stage != ProjectStage.ACTIVE
                ]
                for project in Project.objects.select_for_update().filter(id__in=active_project_ids).order_by("topic_id"):
                    charged_entries.extend(charge_project_participation_credits_once(project, request.user))
            if update_fields.get("stage") == ProjectStage.ARCHIVED:
                completed_project_ids = [
                    project.id
                    for project in projects
                    if project.stage == ProjectStage.ACTIVE
                ]
                for project in Project.objects.select_for_update().filter(id__in=completed_project_ids).order_by("topic_id"):
                    returned_entries.extend(grant_project_completion_credits_once(project, request.user))
        after = {
            "action": action,
            "affected_count": len(projects),
            "ids": ids,
            "missing_ids": missing_ids,
            **update_fields,
        }
        audit(request.user, f"project.bulk_{action}", "Project", "bulk", before={"projects": before}, after=after)
        for entry in charged_entries:
            audit(request.user, "credit.project_participation_cost", "CreditLedger", entry.pk, after=credit_ledger_payload(entry))
        for entry in returned_entries:
            audit(request.user, "credit.project_completion_return", "CreditLedger", entry.pk, after=credit_ledger_payload(entry))

    if action == "delete":
        for path in document_paths:
            maybe_delete_managed_project_document_file(path)

    return ok({"action": action, "affected_count": len(projects), "ids": ids, "missing_ids": missing_ids})


@api.get("/admin/projects/{project_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Admin"])
def admin_project_get(request, project_id: int):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    project = get_object_or_404(Project.objects.select_related("theme", "created_by", "created_by__profile").prefetch_related("tags", "documents"), pk=project_id)
    return ok(project_detail_payload(project))


@api.post("/admin/projects/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_project_create(request, payload: ProjectWriteRequest):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    normalize_project_identity_alias(data)
    error = validate_admin_project_payload(data, creating=True)
    if error:
        audit(
            request.user,
            "project.create",
            "Project",
            "new",
            after=data,
            status="failed",
            error_code=error[1]["error"]["code"],
            error_message=error[1]["error"]["message"],
        )
        return error
    data["stage"] = ProjectStage.DRAFT
    data["is_public"] = False
    if data.get("topic_id") and Project.objects.filter(topic_id=data["topic_id"]).exists():
        audit(
            request.user,
            "project.create",
            "Project",
            "new",
            after=data,
            status="failed",
            error_code="validation_error",
            error_message="id already exists.",
        )
        return fail("id already exists.", status=422, code="validation_error")
    try:
        project = create_project(data, source_label="api-admin", allow_create_theme=False, created_by=request.user)
    except ValueError as exc:
        audit(
            request.user,
            "project.create",
            "Project",
            "new",
            after=data,
            status="failed",
            error_code="validation_error",
            error_message=str(exc),
        )
        return fail(str(exc), status=422, code="validation_error")
    project = get_object_or_404(Project.objects.select_related("theme", "created_by", "created_by__profile").prefetch_related("tags", "documents"), pk=project.pk)
    audit(request.user, "project.create", "Project", project.id, after=project_detail_payload(project))
    return 201, ok(project_detail_payload(project))


@api.patch("/admin/projects/{project_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 409: ErrorEnvelope, 422: ErrorEnvelope, 500: ErrorEnvelope}, tags=["Admin"])
def admin_project_update(request, project_id: int, payload: ProjectWriteRequest):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    project = get_object_or_404(Project.objects.select_related("theme", "created_by", "created_by__profile").prefetch_related("tags", "documents"), pk=project_id)
    try:
        before = run_with_database_lock_retry(lambda: project_detail_payload(project))
    except OperationalError as exc:
        if not is_database_lock_error(exc):
            raise
        return fail("Project update conflict, please retry.", status=409, code="database_busy")
    previous_stage = project.stage
    patch_data = payload.model_dump(exclude_unset=True, exclude_none=True)
    normalize_project_identity_alias(patch_data)
    if "topic_id" in patch_data and patch_data["topic_id"] != project.topic_id:
        audit(
            request.user,
            "project.update",
            "Project",
            project.id,
            before=before,
            after=patch_data,
            status="failed",
            error_code="validation_error",
            error_message="topic_id cannot be changed.",
        )
        return fail("topic_id cannot be changed.", status=422, code="validation_error")
    data = project_import_payload(project)
    data.update(patch_data)
    data["topic_id"] = project.topic_id
    error = validate_admin_project_payload(data, creating=False, current_project=project)
    if error:
        audit(
            request.user,
            "project.update",
            "Project",
            project.id,
            before=before,
            after=data,
            status="failed",
            error_code=error[1]["error"]["code"],
            error_message=error[1]["error"]["message"],
        )
        return error
    charged_entries = []
    returned_entries = []
    try:
        def update_admin_project():
            with transaction.atomic():
                locked_project = (
                    Project.objects.select_for_update()
                    .select_related("theme", "created_by", "created_by__profile")
                    .prefetch_related("tags", "documents")
                    .get(pk=project.pk)
                )
                updated_project = update_project(locked_project, data, source_label="api-admin", allow_create_theme=False)
                if previous_stage != ProjectStage.ACTIVE and updated_project.stage == ProjectStage.ACTIVE:
                    charged_entries[:] = charge_project_participation_credits_once(updated_project, request.user)
                if previous_stage == ProjectStage.ACTIVE and updated_project.stage == ProjectStage.ARCHIVED:
                    returned_entries[:] = grant_project_completion_credits_once(updated_project, request.user)
                refreshed_project = (
                    Project.objects.select_related("theme", "created_by", "created_by__profile")
                    .prefetch_related("tags", "documents")
                    .get(pk=updated_project.pk)
                )
                after_payload = project_detail_payload(refreshed_project)
                audit(request.user, "project.update", "Project", refreshed_project.id, before=before, after=after_payload)
                for entry in charged_entries:
                    audit(request.user, "credit.project_participation_cost", "CreditLedger", entry.pk, after=credit_ledger_payload(entry))
                for entry in returned_entries:
                    audit(request.user, "credit.project_completion_return", "CreditLedger", entry.pk, after=credit_ledger_payload(entry))
            return after_payload

        after_payload = run_with_database_lock_retry(update_admin_project)
    except ValueError as exc:
        audit(
            request.user,
            "project.update",
            "Project",
            project.id,
            before=before,
            after=data,
            status="failed",
            error_code="validation_error",
            error_message=str(exc),
        )
        return fail(str(exc), status=422, code="validation_error")
    except OperationalError as exc:
        if not is_database_lock_error(exc):
            raise
        return audit_failed_response(
            request.user,
            "project.update",
            "Project",
            project.id,
            fail("Project update conflict, please retry.", status=409, code="database_busy"),
            before=before,
            after=data,
        )
    except Exception as exc:
        audit(
            request.user,
            "project.update",
            "Project",
            project.id,
            before=before,
            after=data,
            status="failed",
            error_code="project_update_failed",
            error_message=str(exc),
        )
        return fail("Project update failed.", status=500, code="project_update_failed")
    return ok(after_payload)


@api.delete("/admin/projects/{project_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Admin"])
def admin_project_delete(request, project_id: int):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    project = get_object_or_404(Project.objects.select_related("theme", "created_by", "created_by__profile").prefetch_related("tags", "documents"), pk=project_id)
    before = project_detail_payload(project)
    document_paths = [document.path for document in project.documents.all()]
    for path in document_paths:
        maybe_delete_managed_project_document_file(path)
    project.delete()
    audit(request.user, "project.delete", "Project", project_id, before=before, after={"deleted": True})
    return ok({"id": project_id, "deleted": True})


@api.get("/admin/project-documents/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_project_document_list(request, project_id: int):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id)
    documents = project_documents_for(project)
    return ok({"project_id": project.id, "documents": [document_payload(document) for document in documents]})


@api.post(
    "/admin/project-documents/upload/",
    response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope},
    tags=["Admin"],
)
def admin_project_document_upload(request):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    project_id = request.POST.get("project_id")
    project = get_object_or_404(Project, pk=project_id)
    return save_project_detail_pdf(request, project, "project_document.upload")


@api.post(
    "/project-documents/upload/",
    response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope},
    tags=["Projects"],
)
def user_project_document_upload(request):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project_id = request.POST.get("project_id")
    project = get_object_or_404(Project.objects.select_related("created_by", "created_by__profile"), pk=project_id)
    access_error = require_user_project_document_access(request, project, "project_document.user_upload")
    if access_error:
        return access_error
    return save_project_detail_pdf(request, project, "project_document.user_upload")


def save_project_detail_pdf(request, project, audit_action):
    document_kind = normalize_project_document_kind(request.POST.get("document_kind"))
    if document_kind not in {ProjectDocument.DocumentKind.DETAIL, ProjectDocument.DocumentKind.PROGRESS}:
        return fail("Only project detail or progress PDF is supported.", status=422, code="validation_error")
    description = (request.POST.get("description") or "").strip()
    files = request.FILES.getlist("files")
    if not files:
        return fail("No files uploaded.", status=422, code="validation_error")
    if len(files) != 1:
        return fail("Project PDF upload accepts exactly one file.", status=422, code="validation_error")

    title = (request.POST.get("title") or "").strip()
    root = project_document_root()
    directory = safe_child_path(root, project.topic_code, root, expect_parent=False)
    directory.mkdir(parents=True, exist_ok=True)

    saved = []
    for uploaded in files:
        file_name, validation_error = validate_uploaded_pdf(uploaded, invalid_name_message="file name is invalid.", invalid_suffix_message="Project document must be a PDF.")
        if validation_error:
            return audit_failed_response(request.user, audit_action, "Project", project.id, validation_error)
        destination = unique_project_document_destination(directory, file_name)
        content_hash = write_uploaded_file_with_hash(uploaded, destination)
        old_detail_documents = list(ProjectDocument.objects.filter(project=project, document_kind=ProjectDocument.DocumentKind.DETAIL)) if document_kind == ProjectDocument.DocumentKind.DETAIL else []
        document = ProjectDocument.objects.create(
            project=project,
            doc_type=ProjectDocument.DocumentType.PDF,
            document_kind=document_kind,
            title=title or Path(file_name).stem,
            description=description or ("课题 PDF 详情" if document_kind == ProjectDocument.DocumentKind.DETAIL else "项目进度文档"),
            path=public_media_path(destination),
            content_hash=content_hash,
            uploaded_by=request.user if request.user.is_authenticated else None,
            visibility=ProjectDocument.Visibility.PUBLIC,
        )
        for old_document in old_detail_documents:
            before_path = old_document.path
            old_document.delete()
            maybe_delete_managed_project_document_file(before_path)
        if document_kind == ProjectDocument.DocumentKind.PROGRESS:
            ProjectProgressEntry.objects.create(
                project=project,
                entry_type=ProjectProgressEntry.EntryType.DOCUMENT,
                title=f"上传{document.title}",
                description=document.description,
                document=document,
                created_by=request.user if request.user.is_authenticated else None,
                visibility=ProjectProgressEntry.Visibility.PUBLIC,
            )
            audit(request.user, "project_progress.document_create", "ProjectDocument", document.id, after=document_payload(document))
        saved.append(document_payload(document))
    audit(request.user, audit_action, "Project", project.id, after={"count": len(saved), "documents": saved})
    return 201, ok({"project_id": project.id, "saved": saved, "documents": [document_payload(document) for document in project_documents_for(project)]})


@api.patch(
    "/admin/project-documents/{document_id}/",
    response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope},
    tags=["Admin"],
)
def admin_project_document_update(request, document_id: int, payload: ProjectDocumentWriteRequest):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    document = get_object_or_404(ProjectDocument.objects.select_related("project"), pk=document_id)
    before = document_payload(document)
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "doc_type" in data:
        if normalize_project_document_type(data.get("doc_type")) != ProjectDocument.DocumentType.PDF:
            return fail("Only project detail PDF is supported.", status=422, code="validation_error")
        document.doc_type = ProjectDocument.DocumentType.PDF
    if "document_kind" in data:
        if normalize_project_document_kind(data.get("document_kind")) != ProjectDocument.DocumentKind.DETAIL:
            return fail("Only project detail PDF is supported.", status=422, code="validation_error")
        document.document_kind = ProjectDocument.DocumentKind.DETAIL
        document.doc_type = ProjectDocument.DocumentType.PDF
        ProjectDocument.objects.filter(project=document.project, document_kind=ProjectDocument.DocumentKind.DETAIL).exclude(pk=document.pk).delete()
    if "title" in data:
        document.title = str(data.get("title") or "").strip()[:255]
    if "description" in data:
        document.description = str(data.get("description") or "").strip()
    if "path" in data:
        path = public_document_path_for_admin(data.get("path"))
        if not path:
            return fail("path is invalid.", status=422, code="validation_error")
        document.path = path
    document.save(update_fields=["doc_type", "document_kind", "title", "description", "path"])
    after = document_payload(document)
    audit(request.user, "project_document.update", "ProjectDocument", document.id, before=before, after=after)
    return ok({"document": after, "documents": [document_payload(item) for item in project_documents_for(document.project)]})


@api.delete(
    "/admin/project-documents/{document_id}/",
    response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope},
    tags=["Admin"],
)
def admin_project_document_delete(request, document_id: int):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    document = get_object_or_404(ProjectDocument.objects.select_related("project"), pk=document_id)
    return delete_project_document_for_request(request, document, "project_document.delete")


@api.delete(
    "/project-documents/{document_id}/",
    response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope},
    tags=["Projects"],
)
def user_project_document_delete(request, document_id: int):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    document = get_object_or_404(ProjectDocument.objects.select_related("project", "project__created_by", "project__created_by__profile"), pk=document_id)
    access_error = require_user_project_document_access(request, document.project, "project_document.user_delete")
    if access_error:
        return access_error
    return delete_project_document_for_request(request, document, "project_document.user_delete")


def delete_project_document_for_request(request, document, audit_action):
    project = document.project
    document_id = document.id
    before = document_payload(document)
    maybe_delete_managed_project_document_file(document.path)
    document.delete()
    audit(request.user, audit_action, "ProjectDocument", document_id, before=before)
    return ok({"project_id": project.id, "documents": [document_payload(item) for item in project_documents_for(project)]})


@api.post("/projects/{project_id}/follow/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Interactions"])
def follow_project(request, project_id: int):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id, is_public=True, stage__in=FOLLOWABLE_PROJECT_STAGES)
    follow, created = ProjectFollow.objects.get_or_create(user=request.user, project=project)
    audit(request.user, "project.follow", "ProjectFollow", follow.pk, after=follow_payload(follow))
    return ok({"is_following": True})


@api.post(
    "/projects/{project_id}/unfollow/",
    response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope},
    tags=["Interactions"],
    operation_id="api_ninja_api_unfollow_project_post",
)
@api.delete(
    "/projects/{project_id}/unfollow/",
    response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope},
    tags=["Interactions"],
    operation_id="api_ninja_api_unfollow_project_delete",
)
def unfollow_project(request, project_id: int):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id)
    follows = list(ProjectFollow.objects.filter(user=request.user, project=project))
    for follow in follows:
        audit(request.user, "project.unfollow", "ProjectFollow", follow.pk, before=follow_payload(follow))
    ProjectFollow.objects.filter(user=request.user, project=project).delete()
    return ok({"is_following": False})


@api.post("/projects/{project_id}/score/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Interactions"])
def score_project(request, project_id: int, payload: ScoreRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id, is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
    form = ProjectScoreForm(payload.model_dump())
    if not form.is_valid():
        return fail("Score submit failed.", status=422, code="validation_error", errors=form_errors(form))
    score, _ = ProjectScore.objects.update_or_create(
        user=request.user,
        project=project,
        defaults={"score": form.cleaned_data["score"], "comment": form.cleaned_data.get("comment", "")},
    )
    recalculate_project_community_score(project)
    audit(request.user, "project.score", "ProjectScore", score.pk, after=score_payload(score))
    return ok(score_payload(score))


@api.post(
    "/projects/{project_id}/unscore/",
    response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope},
    tags=["Interactions"],
    operation_id="api_ninja_api_unscore_project_post",
)
@api.delete(
    "/projects/{project_id}/unscore/",
    response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope},
    tags=["Interactions"],
    operation_id="api_ninja_api_unscore_project_delete",
)
def unscore_project(request, project_id: int):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id)
    scores = list(ProjectScore.objects.filter(user=request.user, project=project))
    for score in scores:
        audit(request.user, "project.unscore", "ProjectScore", score.pk, before=score_payload(score))
    ProjectScore.objects.filter(user=request.user, project=project).delete()
    recalculate_project_community_score(project)
    return ok({"is_liked": False, "score": None})


@api.post("/projects/{project_id}/interest/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 409: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Interactions"])
def interest_project(request, project_id: int, payload: InterestRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id, is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
    form = ProjectInterestForm(payload.model_dump())
    if not form.is_valid():
        return audit_failed_response(
            request.user,
            "interaction.submit_interest",
            "Project",
            project.id,
            fail("Interest submit failed.", status=422, code="validation_error", errors=form_errors(form)),
        )
    try:
        def submit_interest():
            with transaction.atomic():
                locked_project = Project.objects.select_for_update().get(pk=project.pk)
                if locked_project.stage not in RECRUITING_PROJECT_STAGES:
                    return audit_failed_response(
                        request.user,
                        "interaction.submit_interest",
                        "Project",
                        locked_project.id,
                        fail("Project is not recruiting.", status=422, code="project_not_recruiting"),
                    )
                locked_profile = UserProfile.objects.select_for_update().get(user=request.user)
                if not has_required_participation_credits(request.user, project=locked_project, profile=locked_profile):
                    return audit_failed_response(
                        request.user,
                        "interaction.submit_interest",
                        "Project",
                        locked_project.id,
                        fail("参与课题需要50积分，当前积分不足。", status=422, code="insufficient_credits"),
                    )
                interest, _ = ProjectInterest.objects.select_for_update().update_or_create(
                    user=request.user,
                    project=locked_project,
                    role=form.cleaned_data["role"],
                    defaults={
                        "available_hours_per_week": form.cleaned_data["available_hours_per_week"],
                        "experience": form.cleaned_data.get("experience", ""),
                        "message": form.cleaned_data.get("message", ""),
                        "authorship_intention": form.cleaned_data["authorship_intention"],
                        "status": InteractionStatus.APPROVED,
                    },
                )
                maybe_advance_project_stage_after_interaction(locked_project, request.user)
                interest.refresh_from_db()
                audit(request.user, "interaction.auto_approve", "ProjectInterest", interest.pk, after=interest_payload(interest))
            return 201, ok(interest_payload(interest))

        return run_with_database_lock_retry(submit_interest)
    except OperationalError as exc:
        if not is_database_lock_error(exc):
            raise
        return audit_failed_response(
            request.user,
            "interaction.submit_interest",
            "Project",
            project.id,
            fail("请求冲突，请稍后重试。", status=409, code="database_busy"),
        )


@api.post("/projects/{project_id}/claim/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 409: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Interactions"])
def claim_project(request, project_id: int, payload: ClaimRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id, is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
    form = ProjectClaimIntentForm(payload.model_dump())
    if not form.is_valid():
        return audit_failed_response(
            request.user,
            "interaction.submit_claim",
            "Project",
            project.id,
            fail("Claim submit failed.", status=422, code="validation_error", errors=form_errors(form)),
        )
    claim_type = form.cleaned_data["claim_type"]
    requires_review = claim_type in REVIEW_REQUIRED_CLAIM_TYPES
    claimed_unit_name = (form.cleaned_data.get("claimed_unit_name") or "").strip()
    message = (form.cleaned_data.get("message") or "").strip()
    if claim_type == ClaimType.PAPER_FIRST_UNIT:
        if not claimed_unit_name:
            return audit_failed_response(
                request.user,
                "interaction.submit_claim",
                "Project",
                project.id,
                fail(
                "请填写拟认领的论文第一单位。",
                status=422,
                code="paper_first_unit_required",
                errors={"claimed_unit_name": ["请填写拟认领的论文第一单位。"]},
                ),
            )
        if len(claimed_unit_name) < 2:
            return audit_failed_response(
                request.user,
                "interaction.submit_claim",
                "Project",
                project.id,
                fail(
                "拟认领的论文第一单位至少需要2个字符。",
                status=422,
                code="validation_error",
                errors={"claimed_unit_name": ["拟认领的论文第一单位至少需要2个字符。"]},
                ),
            )
        if not message:
            message = f"申请认领论文第一单位：{claimed_unit_name}"
    else:
        claimed_unit_name = ""
    try:
        def submit_claim():
            with transaction.atomic():
                locked_project = Project.objects.select_for_update().get(pk=project.pk)
                if locked_project.stage not in RECRUITING_PROJECT_STAGES:
                    return audit_failed_response(
                        request.user,
                        "interaction.submit_claim",
                        "Project",
                        locked_project.id,
                        fail("Project is not recruiting.", status=422, code="project_not_recruiting"),
                    )
                locked_profile = UserProfile.objects.select_for_update().get(user=request.user)
                if not has_required_participation_credits(request.user, project=locked_project, profile=locked_profile):
                    return audit_failed_response(
                        request.user,
                        "interaction.submit_claim",
                        "Project",
                        locked_project.id,
                        fail("参与课题需要50积分，当前积分不足。", status=422, code="insufficient_credits"),
                    )
                if requires_review:
                    active_claims = active_claim_slot_queryset(locked_project, claim_type).select_for_update()
                    if active_claims.filter(user=request.user).exists():
                        return audit_failed_response(
                            request.user,
                            "interaction.submit_claim",
                            "Project",
                            locked_project.id,
                            fail("你已提交该认领，不能重复提交。", status=422, code="claim_already_active"),
                        )
                    active_count = active_claims.count()
                    if active_count > 1:
                        return audit_failed_response(
                            request.user,
                            "interaction.submit_claim",
                            "Project",
                            locked_project.id,
                            fail("该课题认领数据存在冲突，请联系管理员处理。", status=422, code="claim_data_conflict"),
                        )
                    if active_count == 1:
                        return audit_failed_response(
                            request.user,
                            "interaction.submit_claim",
                            "Project",
                            locked_project.id,
                            fail("该认领席位已被占用，暂不能重复认领。", status=409, code="claim_slot_occupied"),
                        )
                claim, _ = ProjectClaimIntent.objects.update_or_create(
                    user=request.user,
                    project=locked_project,
                    claim_type=claim_type,
                    defaults={
                        "claimed_unit_name": claimed_unit_name,
                        "message": message,
                        "status": InteractionStatus.PENDING if requires_review else InteractionStatus.APPROVED,
                        "review_comment": "",
                        "reviewed_by": None,
                        "reviewed_at": None,
                    },
                )
                if claim.status == InteractionStatus.APPROVED:
                    maybe_advance_project_stage_after_interaction(locked_project, request.user)
                claim.refresh_from_db()
                audit_action = "interaction.submit_claim_for_review" if requires_review else "interaction.auto_approve"
                audit(request.user, audit_action, "ProjectClaimIntent", claim.pk, after=claim_payload(claim))
            return 201, ok(claim_payload(claim))

        return run_with_database_lock_retry(submit_claim)
    except (IntegrityError, OperationalError) as exc:
        if isinstance(exc, OperationalError) and not is_database_lock_error(exc):
            raise
        return audit_failed_response(
            request.user,
            "interaction.submit_claim",
            "Project",
            project.id,
            fail("该认领席位已被占用，暂不能重复认领。", status=409, code="claim_slot_occupied"),
        )


@api.post("/projects/{project_id}/sponsor/", response={200: Envelope, 201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 409: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Interactions"])
def sponsor_project(request, project_id: int, payload: SponsorRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id, is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
    form = SponsorIntentForm(payload.model_dump())
    if not form.is_valid():
        return audit_failed_response(
            request.user,
            "interaction.submit_sponsor",
            "Project",
            project.id,
            fail("Sponsor intent submit failed.", status=422, code="validation_error", errors=form_errors(form)),
        )
    try:
        def submit_sponsor():
            with transaction.atomic():
                locked_project = Project.objects.select_for_update().get(pk=project.pk)
                if locked_project.stage not in RECRUITING_PROJECT_STAGES:
                    return audit_failed_response(
                        request.user,
                        "interaction.submit_sponsor",
                        "Project",
                        locked_project.id,
                        fail("Project is not recruiting.", status=422, code="project_not_recruiting"),
                    )
                sponsor, created = SponsorIntent.objects.select_for_update().get_or_create(
                    user=request.user,
                    project=locked_project,
                    sponsor_type=form.cleaned_data["sponsor_type"],
                    defaults={"note": form.cleaned_data.get("note", ""), "status": InteractionStatus.PENDING},
                )
                if created:
                    action = "interaction.submit_sponsor"
                    status_code = 201
                else:
                    before = sponsor_payload(sponsor)
                    sponsor.note = form.cleaned_data.get("note", "")
                    if sponsor.status in {InteractionStatus.REJECTED, InteractionStatus.WITHDRAWN}:
                        sponsor.status = InteractionStatus.PENDING
                        sponsor.review_comment = ""
                        sponsor.reviewed_by = None
                        sponsor.reviewed_at = None
                        action = "interaction.sponsor_resubmit"
                        status_code = 201
                    else:
                        action = "interaction.sponsor_update_note"
                        status_code = 200
                    sponsor.save(update_fields=["note", "status", "review_comment", "reviewed_by", "reviewed_at", "updated_at"])
                    sponsor.refresh_from_db()
                    audit(request.user, action, "SponsorIntent", sponsor.pk, before=before, after=sponsor_payload(sponsor))
                    return status_code, ok(sponsor_payload(sponsor))
                audit(request.user, action, "SponsorIntent", sponsor.pk, after=sponsor_payload(sponsor))
            return status_code, ok(sponsor_payload(sponsor))

        return run_with_database_lock_retry(submit_sponsor)
    except (IntegrityError, OperationalError) as exc:
        if isinstance(exc, OperationalError) and not is_database_lock_error(exc):
            raise
        return audit_failed_response(
            request.user,
            "interaction.submit_sponsor",
            "Project",
            project.id,
            fail("请求冲突，请稍后重试。", status=409, code="database_busy"),
        )


def ok(data=None):
    return {"ok": True, "data": data}


def fail(message, status=400, code="bad_request", errors=None):
    return status, error_payload(message, code, errors)


def is_database_lock_error(exc):
    message = str(exc).lower()
    return "database is locked" in message or "database table is locked" in message


def run_with_database_lock_retry(operation):
    last_error = None
    for attempt in range(DATABASE_LOCK_RETRY_ATTEMPTS):
        try:
            return operation()
        except OperationalError as exc:
            if not is_database_lock_error(exc):
                raise
            last_error = exc
            close_old_connections()
            if attempt < DATABASE_LOCK_RETRY_ATTEMPTS - 1:
                time.sleep(DATABASE_LOCK_RETRY_DELAY_SECONDS * (attempt + 1))
    raise last_error


def audit_failed_response(actor, action, target_type, target_id, response_tuple, before=None, after=None):
    try:
        _, payload = response_tuple
        error = payload.get("error", {})
        error_code = error.get("code", "")
        error_message = error.get("message", "")
    except (TypeError, AttributeError, ValueError):
        error_code = ""
        error_message = ""
    try:
        run_with_database_lock_retry(
            lambda: audit(
                actor,
                action,
                target_type,
                target_id,
                before=before,
                after=after,
                status="failed",
                error_code=error_code,
                error_message=error_message,
            )
        )
    except OperationalError as exc:
        if not is_database_lock_error(exc):
            raise
    return response_tuple


def password_reset_form_errors(form):
    errors = form_errors(form)
    mapped = {}
    for key, value in errors.items():
        if key == "new_password1":
            mapped["password1"] = value
        elif key == "new_password2":
            mapped["password2"] = value
        else:
            mapped[key] = value
    return mapped


def error_payload(message, code="bad_request", errors=None):
    request_id = current_request_id()
    payload = {"ok": False, "request_id": request_id, "error": {"code": code, "message": message, "request_id": request_id}}
    if errors is not None:
        payload["error"]["details"] = errors
        payload["errors"] = errors
    return payload


def require_login(request):
    if not request.user.is_authenticated:
        return fail("Authentication required.", status=401, code="auth_required")
    return None


def require_capability(request, capability):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    if not has_capability(request.user, capability):
        audit(
            request.user,
            "permission.denied",
            "Capability",
            capability,
            status="failed",
            error_code="permission_denied",
            error_message="Permission denied.",
        )
        return fail("Permission denied.", status=403, code="permission_denied")
    return None


def require_content_backup_capability(request):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    if not has_capability(request.user, "manage_themes"):
        return fail("Permission denied.", status=403, code="permission_denied")
    return None


def user_can_bypass_project_upload_quota(user):
    return has_capability(user, "manage_projects")


def user_project_uploads_today(user):
    return Project.objects.filter(created_by=user, created_at__date=timezone.localdate()).count()


def build_content_backup_manifest():
    files = {}
    themes = [
        {
            "name": theme.name,
            "slug": theme.slug,
            "description": theme.description,
            "cover_image": theme.cover_image,
            "sort_order": theme.sort_order,
            "is_active": theme.is_active,
        }
        for theme in Theme.objects.order_by("sort_order", "name")
    ]
    tags = [{"name": tag.name, "slug": tag.slug} for tag in Tag.objects.order_by("name")]

    theme_files = []
    for item in ThemeFile.objects.select_related("theme").order_by("theme__slug", "sort_order", "title"):
        payload = {
            "theme_slug": item.theme.slug,
            "section": item.section,
            "file_type": item.file_type,
            "title": item.title,
            "description": item.description,
            "path": item.path,
            "detail_pdf_title": item.detail_pdf_title,
            "detail_pdf_path": item.detail_pdf_path,
            "detail_pdf_hash": item.detail_pdf_hash,
            "sort_order": item.sort_order,
            "is_active": item.is_active,
        }
        attach_backup_file(payload, "detail_pdf_path", files)
        theme_files.append(payload)

    projects = []
    for project in Project.objects.select_related("theme").prefetch_related("tags", "documents").order_by("topic_id"):
        projects.append(
            {
                "topic_id": project.topic_id,
                "title": project.title,
                "title_en": project.title_en,
                "summary": project.summary,
                "problem_statement": project.problem_statement,
                "clinical_endpoint": project.clinical_endpoint,
                "existing_foundation": project.existing_foundation,
                "team_requirements": project.team_requirements,
                "project_progress": project.project_progress,
                "target_venue": project.target_venue,
                "theme_slug": project.theme.slug if project.theme else "",
                "stage": project.stage,
                "source_payload": json_safe(project.source_payload or {}),
                "is_public": project.is_public,
                "tag_slugs": [tag.slug for tag in project.tags.all()],
            }
        )

    project_documents = []
    for item in ProjectDocument.objects.select_related("project").order_by("project__topic_id", "created_at", "id"):
        payload = {
            "project_topic_id": item.project.topic_id,
            "doc_type": item.doc_type,
            "document_kind": item.document_kind,
            "title": item.title,
            "description": item.description,
            "path": item.path,
            "content_hash": item.content_hash,
            "visibility": item.visibility,
        }
        attach_backup_file(payload, "path", files)
        project_documents.append(payload)

    project_progress_entries = []
    progress_entries = (
        ProjectProgressEntry.objects.select_related("project", "document")
        .order_by("project__topic_id", "occurred_at", "id")
    )
    for item in progress_entries:
        project_progress_entries.append(
            {
                "project_topic_id": item.project.topic_id,
                "entry_type": item.entry_type,
                "title": item.title,
                "description": item.description,
                "occurred_at": timezone.localtime(item.occurred_at).isoformat() if item.occurred_at else "",
                "document_path": item.document.path if item.document else "",
                "visibility": item.visibility,
            }
        )

    manifest = {
        "kind": "openmedailab-content-backup",
        "version": 1,
        "app_version": APP_VERSION,
        "created_at": timezone.localtime().isoformat(),
        "counts": {
            "themes": len(themes),
            "tags": len(tags),
            "theme_files": len(theme_files),
            "projects": len(projects),
            "project_documents": len(project_documents),
            "project_progress_entries": len(project_progress_entries),
            "files": len(files),
        },
        "themes": themes,
        "tags": tags,
        "theme_files": theme_files,
        "projects": projects,
        "project_documents": project_documents,
        "project_progress_entries": project_progress_entries,
    }
    return manifest, files


def attach_backup_file(payload, path_key, files):
    source = media_file_for_public_path(payload.get(path_key))
    if not source or not source.is_file():
        payload["backup_file"] = ""
        return
    media_root = Path(settings.MEDIA_ROOT).expanduser().resolve()
    relative = source.resolve().relative_to(media_root).as_posix()
    archive_name = f"files/{relative}"
    payload["backup_file"] = archive_name
    files[archive_name] = source


def restore_content_backup(raw_zip):
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as archive:
        manifest = read_content_backup_manifest(archive)
        restored_files = {}
        with transaction.atomic():
            theme_count = restore_backup_themes(manifest.get("themes", []))
            tag_count = restore_backup_tags(manifest.get("tags", []))
            project_count = restore_backup_projects(manifest.get("projects", []))
            theme_file_count = restore_backup_theme_files(archive, manifest.get("theme_files", []), restored_files)
            document_count = restore_backup_project_documents(archive, manifest.get("project_documents", []), restored_files)
            progress_entry_count = restore_backup_project_progress_entries(manifest.get("project_progress_entries", []))
    return {
        "themes": theme_count,
        "tags": tag_count,
        "projects": project_count,
        "theme_files": theme_file_count,
        "project_documents": document_count,
        "project_progress_entries": progress_entry_count,
        "files": len(restored_files),
    }


def read_content_backup_manifest(archive):
    try:
        raw = archive.read("openmedailab-backup.json")
    except KeyError as exc:
        raise ValueError("备份包缺少 openmedailab-backup.json。") from exc
    try:
        manifest = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("备份清单不是合法 JSON。") from exc
    if manifest.get("kind") != "openmedailab-content-backup":
        raise ValueError("备份包类型不正确。")
    if int(manifest.get("version") or 0) != 1:
        raise ValueError("备份包版本不支持。")
    return manifest


def restore_backup_themes(items):
    count = 0
    for item in items:
        slug = str(item.get("slug") or "").strip()
        name = str(item.get("name") or "").strip()
        if not slug or not name:
            raise ValueError("主题备份记录缺少 name 或 slug。")
        Theme.objects.update_or_create(
            slug=slug,
            defaults={
                "name": name,
                "description": item.get("description") or "",
                "cover_image": item.get("cover_image") or "",
                "sort_order": int(item.get("sort_order") or 0),
                "is_active": bool(item.get("is_active", True)),
            },
        )
        count += 1
    return count


def restore_backup_tags(items):
    count = 0
    for item in items:
        slug = str(item.get("slug") or "").strip()
        name = str(item.get("name") or "").strip() or slug
        if not slug:
            continue
        Tag.objects.update_or_create(slug=slug, defaults={"name": name})
        count += 1
    return count


def restore_backup_projects(items):
    count = 0
    for item in items:
        topic_id = backup_int(item.get("topic_id"), "课题 topic_id 不合法。")
        theme = Theme.objects.filter(slug=str(item.get("theme_slug") or "").strip()).first()
        project, _ = Project.objects.update_or_create(
            topic_id=topic_id,
            defaults={
                "title": str(item.get("title") or "").strip() or f"课题 {topic_id}",
                "title_en": item.get("title_en") or "",
                "summary": item.get("summary") or "",
                "problem_statement": item.get("problem_statement") or "",
                "clinical_endpoint": item.get("clinical_endpoint") or "",
                "existing_foundation": item.get("existing_foundation") or "",
                "team_requirements": item.get("team_requirements") or "",
                "project_progress": item.get("project_progress") or "",
                "target_venue": item.get("target_venue") or "",
                "theme": theme,
                "stage": item.get("stage") if item.get("stage") in ProjectStage.values else ProjectStage.DRAFT,
                "source_payload": item.get("source_payload") if isinstance(item.get("source_payload"), dict) else {},
                "is_public": bool(item.get("is_public", False)),
            },
        )
        tags = [Tag.objects.filter(slug=str(slug or "").strip()).first() for slug in item.get("tag_slugs", [])]
        project.tags.set([tag for tag in tags if tag])
        count += 1
    return count


def restore_backup_theme_files(archive, items, restored_files):
    count = 0
    for item in items:
        theme = Theme.objects.filter(slug=str(item.get("theme_slug") or "").strip()).first()
        if not theme:
            raise ValueError("数据集说明记录引用了不存在的主题。")
        path = str(item.get("path") or "").strip() or unique_dataset_description_path(theme, item.get("title") or "dataset")
        if item.get("backup_file"):
            restored_files[item["backup_file"]] = restore_backup_media_file(archive, item["backup_file"])
        is_active = bool(item.get("is_active", True))
        if is_active:
            ThemeFile.objects.filter(theme=theme, is_active=True).exclude(path=path).update(is_active=False)
        ThemeFile.objects.update_or_create(
            theme=theme,
            path=path,
            defaults={
                "section": item.get("section") or "数据集说明文件",
                "file_type": normalize_theme_file_type(item.get("file_type") or ThemeFile.FileType.DATASET_META),
                "title": item.get("title") or f"{theme.name} 数据集说明",
                "description": item.get("description") or "",
                "detail_pdf_title": item.get("detail_pdf_title") or "",
                "detail_pdf_path": public_document_path_for_admin(item.get("detail_pdf_path") or ""),
                "detail_pdf_hash": item.get("detail_pdf_hash") or restored_files.get(item.get("backup_file"), ""),
                "sort_order": int(item.get("sort_order") or 0),
                "is_active": is_active,
            },
        )
        count += 1
    return count


def restore_backup_project_documents(archive, items, restored_files):
    count = 0
    for item in items:
        topic_id = backup_int(item.get("project_topic_id"), "课题文档引用的课题编号不合法。")
        project = Project.objects.filter(topic_id=topic_id).first()
        if not project:
            raise ValueError("课题文档引用了不存在的课题。")
        path = public_document_path_for_admin(item.get("path") or "")
        if not path:
            raise ValueError("课题文档路径不合法。")
        if item.get("backup_file"):
            restored_files[item["backup_file"]] = restore_backup_media_file(archive, item["backup_file"])
        document = ProjectDocument.objects.filter(project=project, path=path).first()
        if not document:
            document = ProjectDocument(project=project, path=path)
        document.doc_type = normalize_project_document_type(item.get("doc_type"))
        document.document_kind = normalize_project_document_kind(item.get("document_kind"))
        document.title = str(item.get("title") or "").strip()[:255]
        document.description = str(item.get("description") or "")
        document.content_hash = item.get("content_hash") or restored_files.get(item.get("backup_file"), "")
        visibility = str(item.get("visibility") or ProjectDocument.Visibility.PUBLIC)
        document.visibility = visibility if visibility in ProjectDocument.Visibility.values else ProjectDocument.Visibility.PUBLIC
        document.save()
        if document.document_kind == ProjectDocument.DocumentKind.DETAIL:
            ProjectDocument.objects.filter(project=project, document_kind=ProjectDocument.DocumentKind.DETAIL).exclude(pk=document.pk).delete()
        count += 1
    return count


def restore_backup_project_progress_entries(items):
    count = 0
    for item in items:
        topic_id = backup_int(item.get("project_topic_id"), "课题进度记录引用的课题编号不合法。")
        project = Project.objects.filter(topic_id=topic_id).first()
        if not project:
            raise ValueError("课题进度记录引用了不存在的课题。")
        document_path = public_document_path_for_admin(item.get("document_path") or "")
        document = ProjectDocument.objects.filter(project=project, path=document_path).first() if document_path else None
        entry_type = str(item.get("entry_type") or ProjectProgressEntry.EntryType.NOTE)
        if entry_type not in ProjectProgressEntry.EntryType.values:
            entry_type = ProjectProgressEntry.EntryType.NOTE
        visibility = str(item.get("visibility") or ProjectProgressEntry.Visibility.PUBLIC)
        if visibility not in ProjectProgressEntry.Visibility.values:
            visibility = ProjectProgressEntry.Visibility.PUBLIC
        occurred_at = backup_datetime(item.get("occurred_at")) or timezone.now()
        ProjectProgressEntry.objects.update_or_create(
            project=project,
            entry_type=entry_type,
            title=str(item.get("title") or "").strip()[:255] or "项目进度",
            occurred_at=occurred_at,
            document=document,
            defaults={
                "description": item.get("description") or "",
                "visibility": visibility,
                "created_by": None,
            },
        )
        count += 1
    return count


def restore_backup_media_file(archive, archive_name):
    normalized = safe_backup_archive_name(archive_name)
    try:
        member = archive.getinfo(normalized)
    except KeyError as exc:
        raise ValueError(f"备份包缺少文件：{normalized}") from exc
    if member.is_dir():
        raise ValueError(f"备份文件路径不合法：{normalized}")
    relative = normalized.removeprefix("files/")
    media_root = Path(settings.MEDIA_ROOT).expanduser().resolve()
    destination = safe_child_path(media_root, relative, media_root, expect_parent=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    with archive.open(member) as source, destination.open("wb") as output:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            hasher.update(chunk)
            output.write(chunk)
    return hasher.hexdigest()


def safe_backup_archive_name(value):
    raw = str(value or "").replace("\\", "/").strip()
    parts = [part for part in raw.split("/") if part]
    if not parts or parts[0] != "files" or any(part in {".", ".."} for part in parts):
        raise ValueError(f"备份文件路径不合法：{raw}")
    return "/".join(parts)


def media_file_for_public_path(path):
    value = str(path or "").strip().replace("\\", "/")
    if not value:
        return None
    media_url = settings.MEDIA_URL.strip("/")
    if value.startswith("/"):
        value = value.lstrip("/")
    if media_url and value.startswith(f"{media_url}/"):
        relative = value[len(media_url) + 1 :]
    elif value.startswith("media/"):
        relative = value[len("media/") :]
    else:
        return None
    media_root = Path(settings.MEDIA_ROOT).expanduser().resolve()
    try:
        return safe_child_path(media_root, relative, media_root)
    except ValueError:
        return None


def backup_int(value, message):
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(message) from exc
    if parsed <= 0:
        raise ValueError(message)
    return parsed


def backup_datetime(value):
    parsed = parse_datetime(str(value or "").strip())
    if not parsed:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def require_user_project_document_access(request, project, action):
    if has_capability(request.user, "manage_projects"):
        return None
    if project.created_by_id != request.user.id:
        audit(
            request.user,
            action,
            "Project",
            project.id,
            before=project_detail_payload(project),
            status="failed",
            error_code="permission_denied",
            error_message="Permission denied.",
        )
        return fail("Permission denied.", status=403, code="permission_denied")
    if project.stage == ProjectStage.ARCHIVED:
        audit(
            request.user,
            action,
            "Project",
            project.id,
            before=project_detail_payload(project),
            status="failed",
            error_code="user_project_stage_locked",
            error_message="归档课题只能由管理员修改。",
        )
        return fail("归档课题只能由管理员修改。", status=422, code="user_project_stage_locked")
    return None


def require_project_owner_or_admin(request, project, action):
    if project.created_by_id == request.user.id or has_capability(request.user, "manage_projects"):
        return None
    audit(
        request.user,
        action,
        "Project",
        project.id,
        before=project_detail_payload(project),
        status="failed",
        error_code="permission_denied",
        error_message="Permission denied.",
    )
    return fail("Permission denied.", status=403, code="permission_denied")


def contribution_submission_context(request, project_id, title, result_type=None, task_id=None):
    title = str(title or "").strip()
    if not title:
        return None, fail("Contribution title is required.", status=422, code="validation_error")
    try:
        project_pk = int(project_id)
    except (TypeError, ValueError):
        return None, fail("Project is required.", status=422, code="validation_error")
    normalized_result_type = result_type or Contribution.ResultType.STAGE
    if normalized_result_type not in Contribution.ResultType.values:
        return None, fail("Invalid contribution result type.", status=422, code="validation_error")
    project = get_object_or_404(
        Project.objects.select_related("theme"),
        pk=project_pk,
        is_public=True,
        stage__in=PUBLIC_PROJECT_STAGES,
    )
    if project.stage != ProjectStage.ACTIVE:
        return None, fail("Project is not active.", status=422, code="project_not_active")
    if not user_has_approved_project_relation(request.user, project):
        return None, fail("Only approved participants can submit task results.", status=403, code="interaction_not_approved")
    task = None
    if task_id:
        try:
            task_pk = int(task_id)
        except (TypeError, ValueError):
            return None, fail("Task is invalid.", status=422, code="validation_error")
        task = get_object_or_404(
            ProjectTask.objects.select_related("project", "project__theme", "assignee"),
            pk=task_pk,
            assignee=request.user,
        )
        if task.project_id != project.id:
            return None, fail("Task does not belong to this project.", status=422, code="validation_error")
    return {"project": project, "task": task, "title": title, "result_type": normalized_result_type}, None


def create_contribution_submission(request, context, description="", file_path="", after_extra=None):
    project = context["project"]
    task = context["task"]
    with transaction.atomic():
        contribution = Contribution.objects.create(
            user=request.user,
            project=project,
            task=task,
            title=context["title"],
            result_type=context["result_type"],
            description=description or "",
            file_path=file_path or "",
        )
        if task and task.status != ProjectTask.TaskStatus.DONE:
            before = task_payload(task)
            task.status = ProjectTask.TaskStatus.DONE
            task.save(update_fields=["status", "updated_at"])
            audit(request.user, "task.result_submit", "ProjectTask", task.pk, before=before, after=task_payload(task))
        after = contribution_payload(contribution)
        if after_extra:
            after = {**after, **after_extra}
        audit(request.user, "contribution.submit", "Contribution", contribution.pk, after=after)
    return contribution


def save_contribution_document(uploaded, project, user):
    file_name = sanitize_file_name(uploaded.name)
    if not file_name:
        return "", "", fail("file name is invalid.", status=422, code="validation_error")
    suffix = Path(file_name).suffix.lower()
    if suffix not in CONTRIBUTION_DOCUMENT_EXTENSIONS:
        return "", "", fail("任务结果文档只支持 PDF 或 Markdown。", status=422, code="validation_error")
    if getattr(uploaded, "size", 0) > CONTRIBUTION_DOCUMENT_MAX_BYTES:
        return "", "", fail("任务结果文档不能超过 20MB。", status=422, code="validation_error")
    if suffix == ".pdf":
        _, pdf_error = validate_uploaded_pdf(
            uploaded,
            max_bytes=CONTRIBUTION_DOCUMENT_MAX_BYTES,
            invalid_suffix_message="任务结果文档只支持 PDF 或 Markdown。",
            too_large_message="任务结果文档不能超过 20MB。",
        )
        if pdf_error:
            return "", "", pdf_error
    root = contribution_document_root()
    try:
        raw_user_uid = user.profile.uid
    except UserProfile.DoesNotExist:
        raw_user_uid = f"user-{user.id}"
    user_uid = sanitize_file_name(raw_user_uid) or f"user-{user.id}"
    directory = safe_child_path(root, f"{project.topic_code}/{user_uid}", root, expect_parent=False)
    directory.mkdir(parents=True, exist_ok=True)
    destination = unique_contribution_document_destination(directory, file_name)
    content_hash = write_uploaded_file_with_hash(uploaded, destination)
    return public_media_path(destination), content_hash, None


def choice_payload(choices):
    return [{"value": value, "label": label} for value, label in choices]


def paginated_queryset(queryset, page, page_size, serializer, max_page_size=100):
    page_size = max(1, min(page_size, max_page_size))
    paginator = Paginator(queryset, page_size)
    page_obj = paginator.get_page(page)
    return {
        "results": [serializer(item) for item in page_obj.object_list],
        "pagination": {
            "page": page_obj.number,
            "page_size": page_size,
            "total_pages": paginator.num_pages,
            "total_count": paginator.count,
            "has_next": page_obj.has_next(),
            "has_previous": page_obj.has_previous(),
        },
    }


def paginated_list(rows, page, page_size, max_page_size=100):
    page_size = max(1, min(page_size, max_page_size))
    paginator = Paginator(rows, page_size)
    page_obj = paginator.get_page(page)
    return {
        "results": list(page_obj.object_list),
        "pagination": {
            "page": page_obj.number,
            "page_size": page_size,
            "total_pages": paginator.num_pages,
            "total_count": paginator.count,
            "has_next": page_obj.has_next(),
            "has_previous": page_obj.has_previous(),
        },
    }


def participant_uids_for_project(project):
    active_statuses = [InteractionStatus.APPROVED]
    user_ids = set(
        ProjectInterest.objects.filter(project=project, status__in=active_statuses).values_list("user_id", flat=True)
    )
    user_ids.update(ProjectClaimIntent.objects.filter(project=project, status__in=active_statuses).values_list("user_id", flat=True))
    user_ids.update(SponsorIntent.objects.filter(project=project, status__in=active_statuses).values_list("user_id", flat=True))
    return list(UserProfile.objects.filter(user_id__in=user_ids).order_by("uid").values_list("uid", flat=True))


def status_uids_for_project(participant_uids, viewer_state_payload, authenticated):
    if not authenticated:
        return {"count": 0, "uids_visible": False, "uids": [], "highlight_uid": None}
    uids = set(participant_uids)
    highlight_uid = viewer_state_payload.get("uid")
    viewer_has_project_state = any(
        [
            viewer_state_payload.get("is_following"),
            viewer_state_payload.get("interest_roles"),
            viewer_state_payload.get("claim_types"),
            viewer_state_payload.get("sponsor_types"),
            highlight_uid in uids,
        ]
    )
    if highlight_uid and viewer_has_project_state:
        uids.add(highlight_uid)
    return {
        "count": len(uids),
        "uids_visible": True,
        "uids": sorted(uids),
        "highlight_uid": highlight_uid if highlight_uid in uids else None,
    }


def status_uid_groups_for_project(project, authenticated):
    if not authenticated:
        return {"uids_visible": False, "groups": []}

    grouped = {}
    status_order = {
        InteractionStatus.APPROVED: 0,
        InteractionStatus.PENDING: 1,
        InteractionStatus.REJECTED: 2,
        InteractionStatus.WITHDRAWN: 3,
    }

    def profile_uid_for(user):
        if not user:
            return None
        try:
            return user.profile.uid
        except UserProfile.DoesNotExist:
            return None

    def add_uid(group_type, key, label, uid, sort_key, status="", status_label="", subtype="", subtype_label=""):
        if not uid:
            return
        group = grouped.setdefault(
            key,
            {
                "key": key,
                "type": group_type,
                "label": label,
                "status": status,
                "status_label": status_label,
                "subtype": subtype,
                "subtype_label": subtype_label,
                "uids": set(),
                "sort_key": sort_key,
            },
        )
        group["uids"].add(uid)

    follow_rows = ProjectFollow.objects.filter(project=project).select_related("user__profile")
    for follow in follow_rows:
        add_uid("follow", "follow", "收藏", profile_uid_for(follow.user), (0, 0, "收藏"))

    interest_rows = ProjectInterest.objects.filter(project=project).select_related("user__profile").order_by("status", "role")
    for interest in interest_rows:
        key = f"interest-{interest.role}-{interest.status}"
        label = f"参与：{interest.get_role_display()}（{interest.get_status_display()}）"
        add_uid(
            "interest",
            key,
            label,
            profile_uid_for(interest.user),
            (1, status_order.get(interest.status, 99), label),
            status=interest.status,
            status_label=interest.get_status_display(),
            subtype=interest.role,
            subtype_label=interest.get_role_display(),
        )

    claim_rows = ProjectClaimIntent.objects.filter(project=project).select_related("user__profile").order_by("status", "claim_type")
    for claim in claim_rows:
        key = f"claim-{claim.claim_type}-{claim.status}"
        label = f"{claim.get_claim_type_display()}（{claim.get_status_display()}）"
        if claim.claim_type == ClaimType.PAPER_FIRST_UNIT and claim.claimed_unit_name:
            label = f"{claim.get_claim_type_display()}：{claim.claimed_unit_name}（{claim.get_status_display()}）"
        add_uid(
            "claim",
            key,
            label,
            profile_uid_for(claim.user),
            (2, status_order.get(claim.status, 99), label),
            status=claim.status,
            status_label=claim.get_status_display(),
            subtype=claim.claim_type,
            subtype_label=claim.get_claim_type_display(),
        )

    sponsor_rows = SponsorIntent.objects.filter(project=project).select_related("user__profile").order_by("status", "sponsor_type")
    for sponsor in sponsor_rows:
        key = f"sponsor-{sponsor.sponsor_type}-{sponsor.status}"
        label = f"资助：{sponsor.get_sponsor_type_display()}（{sponsor.get_status_display()}）"
        add_uid(
            "sponsor",
            key,
            label,
            profile_uid_for(sponsor.user),
            (3, status_order.get(sponsor.status, 99), label),
            status=sponsor.status,
            status_label=sponsor.get_status_display(),
            subtype=sponsor.sponsor_type,
            subtype_label=sponsor.get_sponsor_type_display(),
        )

    groups = []
    for group in sorted(grouped.values(), key=lambda item: item["sort_key"]):
        uids = sorted(group["uids"])
        groups.append(
            {
                "key": group["key"],
                "type": group["type"],
                "label": group["label"],
                "status": group["status"],
                "status_label": group["status_label"],
                "subtype": group["subtype"],
                "subtype_label": group["subtype_label"],
                "count": len(uids),
                "uids": uids,
            }
        )
    return {"uids_visible": True, "groups": groups}


def pending_interaction_count():
    return (
        SponsorIntent.objects.filter(status=InteractionStatus.PENDING).count()
        + ProjectClaimIntent.objects.filter(status=InteractionStatus.PENDING, claim_type__in=REVIEW_REQUIRED_CLAIM_TYPES).count()
    )


def maybe_advance_project_stage_after_interaction(project, actor):
    if project.stage not in {ProjectStage.OPEN_RECRUITING, ProjectStage.TEAM_BUILDING}:
        return
    before_project = project_detail_payload(project)
    next_stage = None
    if project.stage == ProjectStage.OPEN_RECRUITING:
        next_stage = ProjectStage.TEAM_BUILDING
        action = "project.stage_auto_team_building"
    if not next_stage or next_stage == project.stage:
        return
    project.stage = next_stage
    project.save(update_fields=["stage", "updated_at"])
    project.refresh_from_db()
    audit(
        actor,
        action,
        "Project",
        project.pk,
        before=before_project,
        after=project_detail_payload(project),
    )


def user_has_approved_project_relation(user, project):
    filters = {"user": user, "project": project, "status": InteractionStatus.APPROVED}
    return (
        ProjectInterest.objects.filter(**filters).exists()
        or ProjectClaimIntent.objects.filter(**filters).exists()
    )


def get_visible_project_for_project_page(request, project_id):
    queryset = project_stat_annotations(
        Project.objects.filter(is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
        .select_related("theme", "created_by", "created_by__profile")
        .prefetch_related("tags", "documents")
    )
    return queryset.filter(pk=project_id).first()


def can_view_project_private_content(user, project):
    if not getattr(user, "is_authenticated", False):
        return False
    return bool(has_capability(user, "manage_projects") or project.created_by_id == user.id)


def project_progress_documents_queryset(project, include_private=False):
    documents = project.documents.filter(
        doc_type=ProjectDocument.DocumentType.PDF,
        document_kind=ProjectDocument.DocumentKind.PROGRESS,
    )
    if not include_private:
        documents = documents.filter(visibility=ProjectDocument.Visibility.PUBLIC)
    return documents.select_related("uploaded_by", "uploaded_by__profile").order_by("-created_at", "-id")


def project_progress_entries_queryset(project, include_private=False):
    entries = project.progress_entries.select_related("document", "created_by", "created_by__profile")
    if not include_private:
        entries = entries.filter(visibility=ProjectProgressEntry.Visibility.PUBLIC)
    return entries.order_by("-occurred_at", "-id")


def get_public_project_for_discussions(project_id):
    return get_object_or_404(
        Project.objects.filter(is_public=True, stage__in=PUBLIC_PROJECT_STAGES),
        pk=project_id,
    )


def visible_replies_by_parent(roots):
    root_ids = [item.id for item in roots]
    if not root_ids:
        return {}
    replies = (
        ProjectDiscussion.objects.filter(parent_id__in=root_ids, status=ProjectDiscussion.Status.VISIBLE)
        .select_related("author", "author__profile")
        .order_by("created_at", "id")
    )
    grouped = {}
    for reply in replies:
        grouped.setdefault(reply.parent_id, []).append(reply)
    return grouped


def validate_discussion_content(content):
    text = str(content or "").strip()
    if not text:
        return "", fail("Discussion content is required.", status=422, code="validation_error")
    if len(text) > 2000:
        return "", fail("Discussion content must be within 2000 characters.", status=422, code="validation_error")
    return text, None


def can_manage_discussion(user, discussion):
    if not getattr(user, "is_authenticated", False):
        return False
    return bool(has_capability(user, "manage_projects") or discussion.author_id == user.id)


def discussion_audit_snapshot(discussion):
    content = str(discussion.content or "")
    return {
        "id": discussion.id,
        "project_id": discussion.project_id,
        "parent_id": discussion.parent_id,
        "author": uid_only_user_payload(discussion.author) if discussion.author else None,
        "status": discussion.status,
        "moderation_reason": discussion.moderation_reason,
        "content_excerpt": content[:120],
        "content_length": len(content),
    }


def interaction_kinds(type_filter=""):
    valid = ["claim", "sponsor"]
    if not type_filter:
        return valid
    return [type_filter] if type_filter in valid else []


def interaction_queryset(kind):
    model = interaction_model(kind)
    related_fields = ["user", "user__profile", "project", "project__theme"]
    if kind in {"claim", "sponsor"}:
        related_fields.extend(["reviewed_by", "reviewed_by__profile"])
    queryset = model.objects.select_related(*related_fields).prefetch_related("project__tags").order_by("-updated_at")
    if kind == "claim":
        queryset = queryset.filter(claim_type__in=REVIEW_REQUIRED_CLAIM_TYPES)
    return queryset


def interaction_model(kind):
    models = {
        "interest": ProjectInterest,
        "claim": ProjectClaimIntent,
        "sponsor": SponsorIntent,
    }
    if kind not in models:
        raise Http404("Interaction not found.")
    return models[kind]


def get_interaction_or_404(kind, interaction_id, user=None):
    query = interaction_queryset(kind)
    if user is not None:
        query = query.filter(user=user)
    return get_object_or_404(query, pk=interaction_id)


def interaction_payload(kind, item):
    if kind == "interest":
        subtype = item.role
        subtype_label = item.get_role_display()
        message = item.message
        detail = {
            "available_hours_per_week": item.available_hours_per_week,
            "experience": item.experience,
        }
    elif kind == "claim":
        subtype = item.claim_type
        subtype_label = item.get_claim_type_display()
        message = item.message
        detail = {
            "claimed_unit_name": getattr(item, "claimed_unit_name", ""),
            "review_comment": getattr(item, "review_comment", ""),
            "reviewed_by": uid_only_user_payload(item.reviewed_by) if getattr(item, "reviewed_by_id", None) else None,
            "reviewed_at": getattr(item, "reviewed_at", None),
        }
    else:
        subtype = item.sponsor_type
        subtype_label = item.get_sponsor_type_display()
        message = item.note
        reviewed_by_payload = uid_only_user_payload(item.reviewed_by) if getattr(item, "reviewed_by_id", None) else None
        detail = {
            "sponsor_type": getattr(item, "sponsor_type", ""),
            "sponsor_type_label": item.get_sponsor_type_display(),
            "review_comment": getattr(item, "review_comment", ""),
            "reviewed_by": reviewed_by_payload,
            "reviewed_at": getattr(item, "reviewed_at", None),
        }
    reviewed_by_payload = uid_only_user_payload(item.reviewed_by) if getattr(item, "reviewed_by_id", None) else None
    return {
        "id": item.id,
        "type": kind,
        "type_label": {"interest": "参与意向", "claim": "认领意向", "sponsor": "资助意向"}[kind],
        "subtype": subtype,
        "subtype_label": subtype_label,
        "message": message,
        "detail": detail,
        "status": item.status,
        "status_label": item.get_status_display(),
        "review_comment": getattr(item, "review_comment", ""),
        "reviewed_by": reviewed_by_payload,
        "reviewed_at": getattr(item, "reviewed_at", None),
        "user": uid_only_user_payload(item.user),
        "project": project_summary_payload(item.project),
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def user_from_uid(uid):
    return get_object_or_404(User.objects.select_related("profile"), profile__uid=uid)


def grant_task_reward_once(contribution, actor):
    task = contribution.task
    if not task or not task.credit_reward:
        return False
    task = ProjectTask.objects.select_for_update().get(pk=task.pk)
    if not task.credit_reward:
        return False
    exists = CreditLedger.objects.select_for_update().filter(
        user=contribution.user,
        task=task,
        action_type=CreditLedger.ActionType.TASK_REWARD,
    ).exists()
    if exists:
        return False
    profile = UserProfile.objects.select_for_update().get(user=contribution.user)
    profile.credit_balance += task.credit_reward
    profile.reputation_score += 1
    profile.save(update_fields=["credit_balance", "reputation_score", "updated_at"])
    CreditLedger.objects.create(
        user=contribution.user,
        project=contribution.project,
        task=task,
        action_type=CreditLedger.ActionType.TASK_REWARD,
        amount=task.credit_reward,
        balance_after=profile.credit_balance,
        reason=f"任务完成奖励：{task.title}",
        created_by=actor,
    )
    return True


def update_task_after_contribution_review(task, status):
    if status == ContributionStatus.APPROVED:
        task.status = ProjectTask.TaskStatus.DONE
    elif status in {ContributionStatus.REJECTED, ContributionStatus.NEEDS_REVISION}:
        task.status = ProjectTask.TaskStatus.IN_PROGRESS
    else:
        task.status = ProjectTask.TaskStatus.REVIEW
    task.save(update_fields=["status", "updated_at"])


def viewer_state(user, project):
    score = ProjectScore.objects.filter(user=user, project=project).first()
    is_following = ProjectFollow.objects.filter(user=user, project=project).exists()
    interests = list(ProjectInterest.objects.filter(user=user, project=project).order_by("-updated_at"))
    claims = list(ProjectClaimIntent.objects.filter(user=user, project=project).order_by("-updated_at"))
    sponsors = list(SponsorIntent.objects.filter(user=user, project=project).order_by("-updated_at"))
    active_interests = [item for item in interests if item.status in ACTIVE_VIEWER_INTERACTION_STATUSES]
    active_claims = [item for item in claims if item.status in ACTIVE_VIEWER_INTERACTION_STATUSES]
    active_sponsors = [item for item in sponsors if item.status in ACTIVE_VIEWER_INTERACTION_STATUSES]
    activity_labels = []
    if is_following:
        activity_labels.append("已收藏")
    activity_labels.extend(
        f"参与：{interest.get_role_display()}（{interest.get_status_display()}）" for interest in active_interests
    )
    activity_labels.extend(f"{claim.get_claim_type_display()}（{claim.get_status_display()}）" for claim in active_claims)
    activity_labels.extend(f"资助：{sponsor.get_sponsor_type_display()}（{sponsor.get_status_display()}）" for sponsor in active_sponsors)
    profile = getattr(user, "profile", None)
    return {
        "uid": getattr(profile, "uid", None),
        "is_following": is_following,
        "score": score_payload(score) if score else None,
        "interest_roles": [interest.role for interest in active_interests],
        "claim_types": [claim.claim_type for claim in active_claims],
        "sponsor_types": [sponsor.sponsor_type for sponsor in active_sponsors],
        "sponsor_requests": [sponsor_payload(sponsor) for sponsor in active_sponsors],
        "activity_labels": activity_labels,
    }


def claim_type_label(claim_type):
    return dict(ClaimType.choices).get(claim_type, claim_type)


def claim_relation_label(claim_type):
    if claim_type == ClaimType.LEADER:
        return "项目负责人认领"
    if claim_type == ClaimType.PAPER_FIRST_UNIT:
        return "论文第一单位认领"
    return claim_type_label(claim_type)


def active_claim_slot_queryset(project, claim_type):
    return ProjectClaimIntent.objects.filter(
        project=project,
        claim_type=claim_type,
        status__in=ACTIVE_CLAIM_SLOT_STATUSES,
    )


def claim_availability_for_type(user, project, claim_type):
    label = claim_type_label(claim_type)
    relation_label = claim_relation_label(claim_type)
    authenticated = bool(getattr(user, "is_authenticated", False))
    own_active = None
    if authenticated:
        own_active = active_claim_slot_queryset(project, claim_type).filter(user=user).first()
    if own_active:
        if own_active.status == InteractionStatus.PENDING:
            return {
                "available": False,
                "action": "pending",
                "own_status": own_active.status,
                "own_interaction_id": own_active.pk,
                "reason_code": "own_pending",
                "reason": f"你的{relation_label}正在管理员审批中，审批通过后可撤回{relation_label}。",
            }
        return {
            "available": False,
            "action": "withdraw",
            "own_status": own_active.status,
            "own_interaction_id": own_active.pk,
            "reason_code": "own_approved",
            "reason": f"你的{relation_label}已通过，可撤回{relation_label}。",
        }
    if not authenticated:
        return {
            "available": False,
            "action": "unavailable",
            "reason_code": "login_required",
            "reason": f"登录后才能提交{label}。",
        }
    if project.stage not in RECRUITING_PROJECT_STAGES:
        return {
            "available": False,
            "action": "unavailable",
            "reason_code": "stage_not_recruiting",
            "reason": f"当前课题阶段不接受{label}。",
        }
    active_slots = active_claim_slot_queryset(project, claim_type)
    active_count = active_slots.count()
    if active_count > 1:
        return {
            "available": False,
            "action": "unavailable",
            "reason_code": "data_conflict",
            "reason": f"该课题的{label}数据存在冲突，请联系管理员处理。",
        }
    if active_count == 1:
        return {
            "available": False,
            "action": "unavailable",
            "reason_code": "slot_occupied",
            "reason": f"该课题已有{label}，暂不能重复认领。",
        }
    if not has_required_participation_credits(user, project=project):
        return {
            "available": False,
            "action": "unavailable",
            "reason_code": "insufficient_credits",
            "reason": "参与或认领课题需要50积分，当前积分不足。",
        }
    return {
        "available": True,
        "action": "submit",
        "reason_code": "available",
        "reason": f"可以提交{label}。",
    }


def claim_availability_payload(user, project):
    return {
        claim_type: claim_availability_for_type(user, project, claim_type)
        for claim_type in CLAIM_AVAILABILITY_TYPES
    }


def collaboration_display_name(user):
    if not user:
        return ""
    profile = getattr(user, "profile", None)
    if profile:
        return profile.real_name or profile.display_name or user.username or profile.uid or ""
    return user.username or ""


def collaboration_contact_payload(user, include_name=True, include_wechat=False):
    if not user:
        return None
    profile = getattr(user, "profile", None)
    payload = {
        "uid": getattr(profile, "uid", None),
    }
    if include_name:
        payload["name"] = collaboration_display_name(user)
    if include_wechat:
        payload["wechat"] = getattr(profile, "contact_wechat", "")
        payload["wechat_visible"] = bool(getattr(profile, "contact_wechat", ""))
    return payload


def interest_team_role_key(interest):
    profile = getattr(interest.user, "profile", None)
    role_type = normalize_public_role(getattr(profile, "role_type", ""))
    if not role_type:
        role_type = {
            "医生": RoleType.DOCTOR,
            "学生": RoleType.UNDERGRAD_OR_BELOW,
            "大学老师": RoleType.PHD_OR_ABOVE,
            "AI工程师": RoleType.ENGINEER,
            "工程师": RoleType.ENGINEER,
        }.get(interest.role, "")
    if not role_type and interest.role == "其他":
        role_type = RoleType.UNDERGRAD_OR_BELOW
    if role_type == RoleType.DOCTOR:
        return "doctor"
    if role_type in {RoleType.UNDERGRAD_OR_BELOW, RoleType.MASTER_STUDENT, RoleType.PHD_STUDENT}:
        return "student"
    if role_type == RoleType.PHD_OR_ABOVE:
        return "mentor"
    return ""


def project_team_contact_groups(project, include_wechat=False):
    groups = {role["key"]: [] for role in project.team_status.get("required_roles", [])}
    seen = {key: set() for key in groups}

    def add_member(key, user):
        if key not in groups or not user or user.id in seen[key]:
            return
        payload = collaboration_contact_payload(user, include_wechat=include_wechat)
        if payload:
            groups[key].append(payload)
            seen[key].add(user.id)

    interests = ProjectInterest.objects.filter(project=project, status=InteractionStatus.APPROVED).select_related("user", "user__profile")
    for interest in interests:
        add_member(interest_team_role_key(interest), interest.user)
        if interest.role == ParticipationRole.LEADER:
            add_member("leader", interest.user)

    claims = ProjectClaimIntent.objects.filter(
        project=project,
        status=InteractionStatus.APPROVED,
        claim_type=ClaimType.LEADER,
    ).select_related("user", "user__profile")
    for claim in claims:
        add_member("leader", claim.user)

    return [
        {
            "key": role["key"],
            "label": role["label"],
            "members": groups.get(role["key"], []),
        }
        for role in project.team_status.get("required_roles", [])
    ]


def enrich_project_collaboration_payload(payload, project, user):
    include_contacts = bool(getattr(user, "is_authenticated", False))
    payload["created_by_display"] = collaboration_contact_payload(
        project.created_by,
        include_name=include_contacts,
        include_wechat=include_contacts,
    )
    payload["team_contact_groups"] = project_team_contact_groups(project, include_wechat=include_contacts) if include_contacts else []
    return payload


def project_list_payload(project, user):
    payload = project_summary_payload(project)
    enrich_project_collaboration_payload(payload, project, user)
    payload["claim_availability"] = claim_availability_payload(user, project)
    if getattr(user, "is_authenticated", False):
        payload["viewer_state"] = viewer_state(user, project)
    return payload


def profile_form_initial(profile):
    return {
        "display_name": profile.display_name,
        "real_name": profile.real_name,
        "role_type": profile.role_type,
        "organization": profile.organization,
        "title": profile.title,
        "research_interests": profile.research_interests,
        "skills": profile.skills,
        "available_hours_per_week": profile.available_hours_per_week,
        "contact_email": profile.contact_email,
        "contact_wechat": profile.contact_wechat,
        "bio": profile.bio,
    }


def profile_completion_bonus_ready(profile):
    return bool(
        profile.role_type
        and str(profile.organization or "").strip()
        and str(profile.research_interests or "").strip()
        and str(profile.skills or "").strip()
        and (str(profile.contact_email or "").strip() or str(profile.contact_wechat or "").strip())
    )


def grant_profile_completion_bonus_once(user, actor):
    profile = UserProfile.objects.select_for_update().get(user=user)
    if not profile_completion_bonus_ready(profile):
        return None
    exists = CreditLedger.objects.select_for_update().filter(
        user=user,
        action_type=CreditLedger.ActionType.PROFILE_COMPLETION_BONUS,
    ).exists()
    if exists:
        return None
    profile.credit_balance += PROFILE_COMPLETION_BONUS
    profile.save(update_fields=["credit_balance", "updated_at"])
    return CreditLedger.objects.create(
        user=user,
        action_type=CreditLedger.ActionType.PROFILE_COMPLETION_BONUS,
        amount=PROFILE_COMPLETION_BONUS,
        balance_after=profile.credit_balance,
        reason="首次完善身份、机构、研究兴趣、技能和联系方式",
        created_by=actor,
    )


def reserved_participation_project_ids(user, exclude_project=None):
    project_ids = set(
        ProjectInterest.objects.filter(user=user, status__in=ACTIVE_VIEWER_INTERACTION_STATUSES)
        .exclude(project__stage=ProjectStage.ARCHIVED)
        .values_list("project_id", flat=True)
    )
    project_ids.update(
        ProjectClaimIntent.objects.filter(user=user, status__in=ACTIVE_VIEWER_INTERACTION_STATUSES)
        .exclude(project__stage=ProjectStage.ARCHIVED)
        .values_list("project_id", flat=True)
    )
    if exclude_project:
        project_ids.discard(exclude_project.id)
    if not project_ids:
        return set()
    charged_project_ids = set(
        CreditLedger.objects.filter(
            user=user,
            project_id__in=project_ids,
            action_type=CreditLedger.ActionType.PROJECT_PARTICIPATION_COST,
        ).values_list("project_id", flat=True)
    )
    return project_ids - charged_project_ids


def available_participation_credits(user, exclude_project=None, profile=None):
    profile = profile or getattr(user, "profile", None)
    if not profile:
        return 0
    reserved = len(reserved_participation_project_ids(user, exclude_project=exclude_project)) * PROJECT_PARTICIPATION_CREDIT_COST
    return profile.credit_balance - reserved


def has_required_participation_credits(user, project=None, profile=None):
    return available_participation_credits(user, exclude_project=project, profile=profile) >= PROJECT_PARTICIPATION_CREDIT_COST


def charge_project_participation_credits_once(project, actor):
    user_ids = set(
        ProjectInterest.objects.filter(project=project, status=InteractionStatus.APPROVED)
        .values_list("user_id", flat=True)
    )
    user_ids.update(
        ProjectClaimIntent.objects.filter(project=project, status=InteractionStatus.APPROVED)
        .values_list("user_id", flat=True)
    )
    charged = []
    for profile in UserProfile.objects.select_for_update().filter(user_id__in=user_ids).select_related("user").order_by("uid"):
        exists = CreditLedger.objects.select_for_update().filter(
            user=profile.user,
            project=project,
            action_type=CreditLedger.ActionType.PROJECT_PARTICIPATION_COST,
        ).exists()
        if exists:
            continue
        profile.credit_balance -= PROJECT_PARTICIPATION_CREDIT_COST
        profile.save(update_fields=["credit_balance", "updated_at"])
        charged.append(
            CreditLedger.objects.create(
                user=profile.user,
                project=project,
                action_type=CreditLedger.ActionType.PROJECT_PARTICIPATION_COST,
                amount=-PROJECT_PARTICIPATION_CREDIT_COST,
                balance_after=profile.credit_balance,
                reason=f"课题进入进行中：{project.topic_code}",
                created_by=actor,
            )
        )
    return charged


def grant_project_completion_credits_once(project, actor):
    user_ids = set(
        ProjectInterest.objects.filter(project=project, status=InteractionStatus.APPROVED)
        .values_list("user_id", flat=True)
    )
    user_ids.update(
        ProjectClaimIntent.objects.filter(project=project, status=InteractionStatus.APPROVED)
        .values_list("user_id", flat=True)
    )
    returned = []
    for profile in UserProfile.objects.select_for_update().filter(user_id__in=user_ids).select_related("user").order_by("uid"):
        exists = CreditLedger.objects.select_for_update().filter(
            user=profile.user,
            project=project,
            action_type=CreditLedger.ActionType.PROJECT_COMPLETION_RETURN,
        ).exists()
        if exists:
            continue
        profile.credit_balance += PROJECT_COMPLETION_CREDIT_RETURN
        profile.save(update_fields=["credit_balance", "updated_at"])
        returned.append(
            CreditLedger.objects.create(
                user=profile.user,
                project=project,
                action_type=CreditLedger.ActionType.PROJECT_COMPLETION_RETURN,
                amount=PROJECT_COMPLETION_CREDIT_RETURN,
                balance_after=profile.credit_balance,
                reason=f"课题结题返还：{project.topic_code}",
                created_by=actor,
            )
        )
    return returned


def validate_admin_project_payload(data, creating, current_project=None, allow_create_theme=False):
    topic_id = normalize_project_topic_id(data.get("topic_id"))
    title = (data.get("title") or "").strip()
    if not title:
        return fail("title is required.", status=422, code="validation_error")
    if data.get("topic_id") not in (None, ""):
        if not topic_id:
            return fail("id must be between 1 and 9999 or use T0001 format.", status=422, code="validation_error")
        data["topic_id"] = topic_id
    data["title"] = title

    summary = str(data.get("summary") or "").strip()
    if not summary:
        return fail("summary is required.", status=422, code="validation_error")
    data["summary"] = summary

    for field, label in [
        ("problem_statement", "科学问题"),
        ("clinical_endpoint", "临床终点"),
        ("existing_foundation", "已有基础"),
    ]:
        value = str(data.get(field) or "").strip()
        if len(value) > 250:
            return fail(f"{label} must be within 250 characters.", status=422, code="validation_error")
        data[field] = value

    data["team_requirements"] = str(data.get("team_requirements") or "").strip()

    for field, limit, label in [
        ("target_venue", 255, "目标期刊/会议"),
    ]:
        value = str(data.get(field) or "").strip()
        if len(value) > limit:
            return fail(f"{label} must be within {limit} characters.", status=422, code="validation_error")
        data[field] = value
    data["project_progress"] = str(data.get("project_progress") or "").strip()

    theme = data.get("theme")
    if isinstance(theme, dict):
        theme_name = (theme.get("name") or theme.get("slug") or "").strip()
    else:
        theme_name = str(theme or "").strip()
    if not theme_name:
        return fail("theme is required.", status=422, code="validation_error")
    theme_obj = theme_from_payload(data, current=current_project.theme if current_project else None)
    if theme_obj is None and not allow_create_theme:
        return fail("theme does not exist.", status=422, code="validation_error")

    stage = data.get("stage")
    stage_labels = {label for _, label in ProjectStage.choices}
    if stage and stage not in ProjectStage.values and stage not in stage_labels:
        return fail("stage is invalid.", status=422, code="validation_error")
    return None


def validate_user_project_payload(data, creating, current_project=None, stage_change_requested=True):
    if creating:
        data.setdefault("stage", ProjectStage.DRAFT)
    error = validate_admin_project_payload(data, creating=creating, current_project=current_project, allow_create_theme=False)
    if error:
        return error
    requested_stage = normalize_project_stage_value(data.get("stage")) or ProjectStage.DRAFT
    data["stage"] = requested_stage
    if (creating or stage_change_requested) and requested_stage not in USER_PROJECT_ALLOWED_STAGES:
        return fail("普通用户只能将课题保存为草稿或发布到开放招募。", status=422, code="user_project_stage_forbidden")
    if requested_stage == ProjectStage.DRAFT:
        data["is_public"] = False
    elif requested_stage == ProjectStage.OPEN_RECRUITING:
        data["is_public"] = True
    return None


def normalize_project_stage_value(stage):
    if not stage:
        return None
    if stage in ProjectStage.values:
        return stage
    for value, label in ProjectStage.choices:
        if stage == label:
            return value
    return stage


def normalize_project_identity_alias(data):
    if "id" in data and "topic_id" not in data:
        data["topic_id"] = data.pop("id")
    else:
        data.pop("id", None)


def normalize_project_topic_id(value):
    if value in (None, ""):
        return None
    text = str(value).strip()
    code_match = re.fullmatch(r"[Tt](\d{4})", text)
    if code_match:
        text = code_match.group(1)
    if not text.isdigit():
        return None
    number = int(text)
    return number if 0 < number <= 9999 else None


def project_search_q(value):
    text = str(value or "").strip()
    query = (
        Q(title__icontains=text)
        | Q(title_en__icontains=text)
        | Q(summary__icontains=text)
        | Q(problem_statement__icontains=text)
        | Q(clinical_endpoint__icontains=text)
        | Q(existing_foundation__icontains=text)
        | Q(team_requirements__icontains=text)
        | Q(project_progress__icontains=text)
        | Q(target_venue__icontains=text)
    )
    topic_id = normalize_project_topic_id(text)
    if topic_id:
        query |= Q(topic_id=topic_id)
    return query


def related_project_search_q(value):
    text = str(value or "").strip()
    query = Q(project__title__icontains=text) | Q(project__title_en__icontains=text)
    topic_id = normalize_project_topic_id(text)
    if topic_id:
        query |= Q(project__topic_id=topic_id)
    return query


def project_import_payload(project):
    return {
        "topic_id": project.topic_id,
        "theme": theme_payload(project.theme) if project.theme else "未分类",
        "title": project.title,
        "title_en": project.title_en,
        "summary": project.summary,
        "problem_statement": project.problem_statement,
        "clinical_endpoint": project.clinical_endpoint,
        "existing_foundation": project.existing_foundation,
        "team_requirements": project.team_requirements,
        "project_progress": project.project_progress,
        "target_venue": project.target_venue,
        "stage": project.stage,
        "tags": [tag.name for tag in project.tags.all()],
        "is_public": project.is_public,
    }


def project_documents_for(project):
    return project.documents.all().order_by("document_kind", "created_at", "id")


def normalize_project_document_type(doc_type):
    if doc_type in ProjectDocument.DocumentType.values:
        return doc_type
    return ProjectDocument.DocumentType.OTHER


def normalize_project_document_kind(document_kind):
    if document_kind in ProjectDocument.DocumentKind.values:
        return document_kind
    return ProjectDocument.DocumentKind.DETAIL


def project_document_type_for_name(name):
    suffix = Path(name or "").suffix.lower()
    if suffix in {".md", ".markdown"}:
        return ProjectDocument.DocumentType.MARKDOWN
    if suffix == ".pdf":
        return ProjectDocument.DocumentType.PDF
    if suffix in {".html", ".htm"}:
        return ProjectDocument.DocumentType.HTML
    return ProjectDocument.DocumentType.OTHER


def project_document_root():
    return (Path(settings.MEDIA_ROOT) / "project-documents").expanduser().resolve()


def contribution_document_root():
    return (Path(settings.MEDIA_ROOT) / "contribution-documents").expanduser().resolve()


def unique_project_document_destination(directory, file_name):
    suffix = Path(file_name).suffix
    stem = Path(file_name).stem or "document"
    candidate = (directory / file_name).resolve()
    index = 2
    while candidate.exists():
        candidate = (directory / f"{stem}-{index}{suffix}").resolve()
        index += 1
    root = project_document_root()
    if candidate.parent != root and root not in candidate.parent.parents:
        raise ValueError("文件路径不能超出课题文档目录。")
    return candidate


def unique_contribution_document_destination(directory, file_name):
    suffix = Path(file_name).suffix
    stem = Path(file_name).stem or "document"
    candidate = (directory / file_name).resolve()
    index = 2
    while candidate.exists():
        candidate = (directory / f"{stem}-{index}{suffix}").resolve()
        index += 1
    root = contribution_document_root()
    if candidate.parent != root and root not in candidate.parent.parents:
        raise ValueError("文件路径不能超出任务结果文档目录。")
    return candidate


def write_uploaded_file_with_hash(uploaded, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    with destination.open("wb") as output:
        for chunk in uploaded.chunks():
            hasher.update(chunk)
            output.write(chunk)
    return hasher.hexdigest()


def validate_uploaded_pdf(
    uploaded,
    *,
    max_bytes=PDF_DOCUMENT_MAX_BYTES,
    invalid_name_message="file name is invalid.",
    invalid_suffix_message="Only PDF files are allowed.",
    too_large_message="PDF 文件不能超过 20MB。",
):
    file_name = sanitize_file_name(uploaded.name)
    if not file_name:
        return "", fail(invalid_name_message, status=422, code="validation_error")
    if Path(file_name).suffix.lower() != ".pdf":
        return "", fail(invalid_suffix_message, status=422, code="validation_error")
    if getattr(uploaded, "size", 0) > max_bytes:
        return "", fail(too_large_message, status=422, code="validation_error")
    if not uploaded_file_has_pdf_signature(uploaded):
        return "", fail("PDF 文件格式无法识别。", status=422, code="validation_error")
    return file_name, None


def uploaded_file_has_pdf_signature(uploaded):
    try:
        position = uploaded.tell()
    except (AttributeError, OSError):
        position = 0
    header = uploaded.read(5)
    try:
        uploaded.seek(position)
    except (AttributeError, OSError):
        pass
    return header == b"%PDF-"


def uploaded_file_has_allowed_image_signature(uploaded, suffix):
    try:
        position = uploaded.tell()
    except (AttributeError, OSError):
        position = 0
    header = uploaded.read(16)
    try:
        uploaded.seek(position)
    except (AttributeError, OSError):
        pass
    if suffix == ".png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix in {".jpg", ".jpeg"}:
        return header.startswith(b"\xff\xd8\xff")
    if suffix == ".webp":
        return header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    return False


def public_document_path_for_admin(path):
    value = str(path or "").strip()
    if value.startswith("/media/"):
        value = value.lstrip("/")
    if not value:
        return ""
    if value.startswith(("http://", "https://")):
        return value
    if value.startswith("/") or value.startswith("\\") or ".." in value.replace("\\", "/").split("/"):
        return ""
    if ":" in value:
        return ""
    return value


def project_document_file_for_public_path(path):
    value = str(path or "").strip().lstrip("/")
    media_url = settings.MEDIA_URL.strip("/")
    if not media_url or not value.startswith(f"{media_url}/"):
        return None
    relative = value[len(media_url) + 1 :]
    candidate = (Path(settings.MEDIA_ROOT) / relative).expanduser().resolve()
    root = project_document_root()
    if candidate != root and root in candidate.parents:
        return candidate
    return None


def maybe_delete_managed_project_document_file(path):
    if ProjectDocument.objects.filter(path=path).count() > 1:
        return
    target = project_document_file_for_public_path(path)
    if target and target.is_file():
        target.unlink()


def theme_file_detail_pdf_root():
    return (Path(settings.MEDIA_ROOT) / "theme-file-detail-pdfs").expanduser().resolve()


def unique_theme_file_detail_pdf_destination(directory, file_name):
    suffix = Path(file_name).suffix
    stem = Path(file_name).stem or "dataset-detail"
    candidate = (directory / file_name).resolve()
    index = 2
    while candidate.exists():
        candidate = (directory / f"{stem}-{index}{suffix}").resolve()
        index += 1
    root = theme_file_detail_pdf_root()
    if candidate.parent != root and root not in candidate.parent.parents:
        raise ValueError("文件路径不能超出数据集说明 PDF 目录。")
    return candidate


def theme_file_detail_pdf_for_public_path(path):
    value = str(path or "").strip().lstrip("/")
    media_url = settings.MEDIA_URL.strip("/")
    if not media_url or not value.startswith(f"{media_url}/"):
        return None
    relative = value[len(media_url) + 1 :]
    candidate = (Path(settings.MEDIA_ROOT) / relative).expanduser().resolve()
    root = theme_file_detail_pdf_root()
    if candidate != root and root in candidate.parents:
        return candidate
    return None


def maybe_delete_managed_theme_file_detail_pdf(path, keep_path=""):
    if not path or path == keep_path:
        return
    target = theme_file_detail_pdf_for_public_path(path)
    if target and target.is_file():
        target.unlink()


def safe_child_path(parent, relative_path, root, expect_parent=False):
    raw = str(relative_path or "").replace("\\", "/").strip("/")
    if "\x00" in raw:
        raise ValueError("文件路径不合法。")
    candidate = (parent / raw).resolve() if raw else parent.resolve()
    check = candidate.parent if expect_parent else candidate
    if check != root and root not in check.parents:
        raise ValueError("文件路径不能超出允许目录。")
    return candidate


def sanitize_file_name(name):
    value = str(name or "").replace("\\", "/").split("/")[-1].strip()
    if value in {"", ".", ".."} or "\x00" in value:
        return ""
    return value


def public_media_path(path):
    media_root = Path(settings.MEDIA_ROOT).expanduser().resolve()
    try:
        return f"{settings.MEDIA_URL.rstrip('/')}/{path.resolve().relative_to(media_root).as_posix()}"
    except ValueError:
        return str(path)


def sidebar_qr_root():
    return (Path(settings.MEDIA_ROOT) / "system-qrcodes").expanduser().resolve()


def sidebar_qr_definition(key):
    normalized = str(key or "").strip()
    return next((item for item in SIDEBAR_QR_DEFINITIONS if item["key"] == normalized), None)


def sidebar_qr_files_for_key(key):
    root = sidebar_qr_root()
    return [root / f"{key}{extension}" for extension in SIDEBAR_QR_EXTENSIONS]


def sidebar_qr_existing_file(key):
    for candidate in sidebar_qr_files_for_key(key):
        if candidate.is_file():
            return candidate
    return None


def unique_dataset_description_path(theme, title):
    slug = slugify(title or "dataset", allow_unicode=True) or "dataset"
    base = f"dataset-descriptions/{slug}"
    candidate = base
    index = 2
    while ThemeFile.objects.filter(theme=theme, path=candidate).exists():
        candidate = f"{base}-{index}"
        index += 1
    return candidate


def theme_from_payload(data, current=None):
    if "theme_id" in data and data.get("theme_id"):
        return Theme.objects.filter(pk=data["theme_id"]).first()
    theme_value = data.get("theme")
    if isinstance(theme_value, dict):
        if theme_value.get("id"):
            return Theme.objects.filter(pk=theme_value["id"]).first()
        theme_value = theme_value.get("slug") or theme_value.get("name")
    if theme_value:
        theme_value = str(theme_value).strip()
        return Theme.objects.filter(Q(slug=theme_value) | Q(name=theme_value)).first()
    return current


def normalize_theme_file_type(file_type):
    if file_type in ThemeFile.FileType.values:
        return file_type
    return ThemeFile.FileType.OTHER


def audit(actor, action, target_type, target_id, before=None, after=None, source="api", status="success", error_code="", error_message=""):
    AuditLog.objects.create(
        actor=actor if actor and actor.is_authenticated else None,
        action=bounded_audit_text(action, AUDIT_ACTION_MAX_LENGTH),
        target_type=bounded_audit_text(target_type, AUDIT_TARGET_TYPE_MAX_LENGTH),
        target_id=bounded_audit_text(target_id, AUDIT_TARGET_ID_MAX_LENGTH),
        request_id=current_request_id(),
        source=bounded_audit_text(source, AUDIT_SOURCE_MAX_LENGTH),
        status=bounded_audit_text(status, AUDIT_STATUS_MAX_LENGTH),
        error_code=bounded_audit_text(error_code, AUDIT_ERROR_CODE_MAX_LENGTH),
        error_message=error_message,
        before=json_safe(before or {}),
        after=json_safe(after or {}),
    )


def bounded_audit_text(value, max_length):
    text = str(value or "")
    return text[:max_length]


def audit_user_target_id(user):
    profile = getattr(user, "profile", None)
    return getattr(profile, "uid", "") or getattr(user, "username", "") or getattr(user, "pk", "unknown")


def audit_user_snapshot(user):
    if not user:
        return {}
    profile = getattr(user, "profile", None)
    return {
        "uid": getattr(profile, "uid", ""),
        "username": getattr(user, "username", ""),
        "role_type": getattr(profile, "role_type", ""),
        "role_label": profile.get_role_type_display() if profile else "",
        "organization": getattr(profile, "organization", ""),
        "must_change_password": getattr(profile, "must_change_password", False),
    }


def audit_submitted_user_payload(data):
    return {
        "username": data.get("username", ""),
        "role_type": data.get("role_type", ""),
    }


def safe_profile_update_payload(data):
    return {
        key: value
        for key, value in data.items()
        if key
        in {
            "display_name",
            "real_name",
            "role_type",
            "organization",
            "title",
            "research_interests",
            "skills",
            "available_hours_per_week",
            "contact_wechat",
            "bio",
        }
    }


def json_safe(value):
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [json_safe(item) for item in value]
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value
