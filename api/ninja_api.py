import mimetypes
import shutil
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.forms import SetPasswordForm
from django.contrib.auth.models import User
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Case, IntegerField, Q, Value, When
from django.http import Http404
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError, ValidationError
from ninja.security import SessionAuth

from config.release import APP_VERSION, release_payload
from accounts.forms import RegisterForm, UserProfileForm
from accounts.models import PLATFORM_ADMIN_UID, RoleType, UserProfile
from accounts.services import (
    DefaultPasswordConfigError,
    create_registered_user,
    get_system_default_password,
    reset_user_to_default_password,
)
from credits.models import Contribution, ContributionStatus, CreditLedger
from interactions.forms import ProjectClaimIntentForm, ProjectInterestForm, ProjectScoreForm, SponsorIntentForm
from interactions.models import (
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
from projects.contracts import DEFAULT_THEME_FILE_SPACE, PROJECT_FIELD_CONTRACT, PROJECT_JSONL_TEMPLATE
from projects.importing import create_project, unique_slug, update_project
from projects.models import (
    FOLLOWABLE_PROJECT_STAGES,
    PUBLIC_PROJECT_STAGES,
    RECRUITING_PROJECT_STAGES,
    AuditLog,
    Project,
    ProjectDocument,
    ProjectStage,
    ProjectTask,
    Tag,
    Theme,
    ThemeFile,
)

from .rbac import capabilities_for_user, has_capability
from .responses import form_errors
from .serializers import (
    admin_user_detail_payload,
    audit_log_payload,
    claim_payload,
    contribution_payload,
    credit_ledger_payload,
    dashboard_payload,
    admin_project_summary_payload,
    interest_payload,
    project_detail_payload,
    public_project_detail_payload,
    project_summary_payload,
    score_payload,
    sponsor_payload,
    tag_payload,
    task_payload,
    theme_file_payload,
    theme_payload,
    theme_space_payload,
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
REVIEWABLE_CONTRIBUTION_STATUSES = {ContributionStatus.APPROVED, ContributionStatus.REJECTED}


class Envelope(Schema):
    ok: bool
    data: Any = None


class ErrorDetail(Schema):
    code: str
    message: str
    details: Optional[Any] = None


class ErrorEnvelope(Schema):
    ok: bool
    error: ErrorDetail


class RegisterRequest(Schema):
    username: str
    email: Optional[str] = ""
    display_name: Optional[str] = ""
    role_type: str = "student"
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


class ClaimRequest(Schema):
    claim_type: str
    message: Optional[str] = ""


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
    file_space: Optional[Any] = None
    sort_order: Optional[int] = 0
    is_active: Optional[bool] = True


class ProjectWriteRequest(Schema):
    id: Optional[int] = None
    topic_id: Optional[int] = None
    theme: Optional[Any] = None
    title: Optional[str] = None
    title_en: Optional[str] = ""
    summary: Optional[str] = ""
    problem_statement: Optional[str] = ""
    clinical_endpoint: Optional[str] = ""
    existing_foundation: Optional[str] = ""
    research_goal: Optional[str] = ""
    technical_route: Optional[str] = ""
    data_requirements: Optional[Any] = None
    evaluation_metrics: Optional[Any] = None
    expected_outputs: Optional[Any] = None
    compliance_notes: Optional[str] = ""
    body_markdown: Optional[str] = ""
    stage: Optional[str] = None
    tags: Optional[list[str]] = None
    llm_score: Optional[float] = None
    community_score: Optional[float] = None
    composite_score: Optional[float] = None
    recommended_journal: Optional[str] = ""
    needed_roles: Optional[list[str]] = None
    score_dimensions: Optional[Any] = None
    source_md_path: Optional[str] = ""
    source_pdf_path: Optional[str] = ""
    page_path: Optional[str] = ""
    content_hash: Optional[str] = ""
    documents: Optional[list[dict[str, Any]]] = None
    has_pdf: Optional[bool] = None
    is_public: Optional[bool] = None


class ThemeFileWriteRequest(Schema):
    theme_id: Optional[int] = None
    theme: Optional[Any] = None
    section: Optional[str] = "数据集文件"
    file_type: Optional[str] = "other"
    title: Optional[str] = None
    description: Optional[str] = ""
    path: Optional[str] = None
    sort_order: Optional[int] = 0
    is_active: Optional[bool] = True


class FileSpaceDirectoryRequest(Schema):
    theme_id: int
    path: Optional[str] = ""
    name: str


class FileSpaceFileRequest(Schema):
    theme_id: int
    path: Optional[str] = ""
    name: str
    content: Optional[str] = ""


class FileSpaceUpdateRequest(Schema):
    theme_id: int
    path: str
    new_name: Optional[str] = None
    content: Optional[str] = None


class FileSpaceDeleteRequest(Schema):
    theme_id: int
    path: str


class FileSpaceRootRequest(Schema):
    server_directory: str


class InteractionStatusRequest(Schema):
    status: str
    review_note: Optional[str] = ""


class InteractionWithdrawRequest(Schema):
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


@api.get("/meta/", response={200: Envelope}, tags=["System"], auth=None)
def meta(request):
    return ok(
        {
            "themes": [theme_payload(theme) for theme in Theme.objects.filter(is_active=True).order_by("sort_order", "name")],
            "tags": [tag_payload(tag) for tag in Tag.objects.order_by("name")[:200]],
            "project_stages": choice_payload(ProjectStage.choices),
            "profile_roles": choice_payload(RoleType.choices),
            "participation_roles": choice_payload(ParticipationRole.choices),
            "claim_types": choice_payload(ClaimType.choices),
            "sponsor_types": choice_payload(SponsorType.choices),
            "release": release_payload(),
        }
    )


@api.get("/rbac/", response={200: Envelope}, tags=["System"], auth=None)
def rbac(request):
    return ok(capabilities_for_user(request.user))


@api.get("/project-schema/", response={200: Envelope}, tags=["Projects"], auth=None)
def project_schema(request):
    return ok(
        {
            "fields": PROJECT_FIELD_CONTRACT,
            "jsonl_template": PROJECT_JSONL_TEMPLATE,
            "template_version": "v1",
            "stage_values": choice_payload(ProjectStage.choices),
            "document_types": choice_payload(ProjectDocument.DocumentType.choices),
            "theme_file_types": choice_payload(ThemeFile.FileType.choices),
            "default_theme_file_space": DEFAULT_THEME_FILE_SPACE,
        }
    )


@api.get("/themes/{slug}/space/", response={200: Envelope, 404: ErrorEnvelope}, tags=["Projects"], auth=None)
def theme_space(request, slug: str):
    theme = get_object_or_404(Theme, slug=slug, is_active=True)
    projects = list(
        project_stat_annotations(
            Project.objects.filter(theme=theme, is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
            .select_related("theme")
            .prefetch_related("tags")
        ).order_by("-composite_score", "-updated_at")[:80]
    )
    files = list(ThemeFile.objects.filter(theme=theme, is_active=True).order_by("sort_order", "section", "title")[:300])
    return ok(theme_space_payload(theme, projects, files))


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
        return fail("Registration failed.", status=422, code="validation_error", errors=form_errors(form))
    user = create_registered_user(form)
    login(request, user)
    return 201, ok(user_payload(user))


@api.post("/auth/login/", response={200: Envelope, 400: ErrorEnvelope}, tags=["Auth"], auth=None)
def login_view(request, payload: LoginRequest):
    user = authenticate(request, username=payload.username, password=payload.password)
    if user is None:
        return fail("用户名或密码错误。", status=400, code="invalid_credentials")
    login(request, user)
    return ok(user_payload(user))


@api.post("/auth/logout/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Auth"])
def logout_view(request):
    logout(request)
    return ok({"logged_out": True})


@api.post("/auth/password/change-required/", response={200: Envelope, 401: ErrorEnvelope, 400: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Auth"])
def password_change_required(request, payload: RequiredPasswordChangeRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    if not request.user.profile.must_change_password:
        return fail("Password change is not required.", status=400, code="password_change_not_required")
    form = SetPasswordForm(
        request.user,
        {"new_password1": payload.password1, "new_password2": payload.password2},
    )
    if not form.is_valid():
        return fail("Password reset failed.", status=422, code="validation_error", errors=password_reset_form_errors(form))
    try:
        system_default_password = get_system_default_password()
    except DefaultPasswordConfigError:
        system_default_password = None
    if system_default_password and payload.password1 == system_default_password:
        return fail(
            "Password reset failed.",
            status=422,
            code="validation_error",
            errors={"password1": [{"message": "新密码不能与系统默认密码相同。", "code": "password_unchanged"}]},
        )
    if request.user.check_password(payload.password1):
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
    data = profile_form_initial(request.user.profile)
    data.update({key: value for key, value in payload.model_dump().items() if value is not None})
    form = UserProfileForm(data, instance=request.user.profile)
    if not form.is_valid():
        return fail("Profile update failed.", status=422, code="validation_error", errors=form_errors(form))
    form.save()
    return ok(user_payload(request.user))


@api.put("/me/profile/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Me"])
def profile_put(request, payload: ProfilePatchRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    form = UserProfileForm(payload.model_dump(), instance=request.user.profile)
    if not form.is_valid():
        return fail("Profile update failed.", status=422, code="validation_error", errors=form_errors(form))
    form.save()
    return ok(user_payload(request.user))


@api.get("/projects/", response={200: Envelope}, tags=["Projects"], auth=None)
def project_list(
    request,
    q: str = "",
    theme: str = "",
    tag: str = "",
    stage: str = "",
    has_pdf: str = "",
    sort: str = "recommended",
    page: int = 1,
    page_size: int = 20,
):
    projects = project_stat_annotations(
        Project.objects.filter(is_public=True, stage__in=PUBLIC_PROJECT_STAGES).select_related("theme").prefetch_related("tags")
    )
    q = q.strip()
    theme = theme.strip()
    tag = tag.strip()
    stage = stage.strip()
    has_pdf = has_pdf.strip()

    if q:
        projects = projects.filter(project_search_q(q) | Q(tags__name__icontains=q)).distinct()
    if theme:
        projects = projects.filter(Q(theme__slug=theme) | Q(theme__name=theme))
    if tag:
        projects = projects.filter(Q(tags__slug=tag) | Q(tags__name=tag))
    if stage:
        projects = projects.filter(stage=stage)
    if has_pdf in {"1", "true", "yes"}:
        projects = projects.filter(has_pdf=True)
    elif has_pdf in {"0", "false", "no"}:
        projects = projects.filter(has_pdf=False)

    sort_map = {
        "recommended": ("-composite_score", "-llm_score", "topic_id"),
        "llm_score": ("-llm_score", "topic_id"),
        "community_score": ("-community_score", "topic_id"),
        "follows": ("-follow_count", "-interest_count", "topic_id"),
        "updated": ("-updated_at",),
        "project_id": ("topic_id",),
    }
    projects = projects.order_by(*sort_map.get(sort, sort_map["recommended"]))

    page_size = max(1, min(page_size, 100))
    paginator = Paginator(projects, page_size)
    page_obj = paginator.get_page(page)
    return ok(
        {
            "results": [project_summary_payload(project) for project in page_obj.object_list],
            "pagination": {
                "page": page_obj.number,
                "page_size": page_size,
                "total_pages": paginator.num_pages,
                "total_count": paginator.count,
                "has_next": page_obj.has_next(),
                "has_previous": page_obj.has_previous(),
            },
            "filters": {"q": q, "theme": theme, "tag": tag, "stage": stage, "has_pdf": has_pdf, "sort": sort},
        }
    )


@api.get("/projects/{project_id}/", response={200: Envelope, 404: ErrorEnvelope}, tags=["Projects"], auth=None)
def project_detail(request, project_id: int):
    project = get_object_or_404(
        project_stat_annotations(
            Project.objects.filter(is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
            .select_related("theme")
            .prefetch_related("tags", "documents")
        ),
        pk=project_id,
    )
    data = public_project_detail_payload(project)
    if request.user.is_authenticated:
        data["viewer_state"] = viewer_state(request.user, project)
    return ok(data)


@api.get("/projects/{project_id}/status-card/", response={200: Envelope, 404: ErrorEnvelope}, tags=["Projects"], auth=None)
def project_status_card(request, project_id: int):
    project = get_object_or_404(
        project_stat_annotations(
            Project.objects.filter(is_public=True, stage__in=PUBLIC_PROJECT_STAGES).select_related("theme").prefetch_related("tags")
        ),
        pk=project_id,
    )
    participant_uids = participant_uids_for_project(project)
    viewer_state_payload = viewer_state(request.user, project) if request.user.is_authenticated else {"is_following": False}
    status_uids = status_uids_for_project(participant_uids, viewer_state_payload, bool(request.user.is_authenticated))
    uid_groups = status_uid_groups_for_project(project, bool(request.user.is_authenticated))
    return ok(
        {
            "project": project_summary_payload(project),
            "viewer_state": viewer_state_payload,
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
        rows.extend(interaction_payload(kind, item) for item in query[:500])
    rows.sort(key=lambda item: item["updated_at"], reverse=True)
    return ok(paginated_list(rows, page, page_size))


@api.patch(
    "/admin/interactions/{type}/{interaction_id}/status/",
    response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope},
    tags=["Admin"],
)
def admin_interaction_update_status(request, type: str, interaction_id: int, payload: InteractionStatusRequest):
    auth_error = require_capability(request, "review_interactions")
    if auth_error:
        return auth_error
    if payload.status not in REVIEWABLE_INTERACTION_STATUSES:
        return fail("Invalid interaction status.", status=422, code="validation_error")
    with transaction.atomic():
        item = get_interaction_or_404(type, interaction_id)
        item = item.__class__.objects.select_for_update().select_related("user", "user__profile", "project", "project__theme").get(pk=item.pk)
        project = Project.objects.select_for_update().get(pk=item.project_id)
        before = interaction_payload(type, item)
        if item.status != InteractionStatus.PENDING:
            return fail("Only pending interactions can be reviewed.", status=422, code="interaction_not_pending")
        previous_project_stage = project.stage
        item.status = payload.status
        item.save(update_fields=["status", "updated_at"])
        if payload.status == InteractionStatus.APPROVED and project.stage == ProjectStage.OPEN_RECRUITING:
            before_project = project_detail_payload(project)
            project.stage = ProjectStage.TEAM_BUILDING
            project.save(update_fields=["stage", "updated_at"])
            project.refresh_from_db()
            audit(
                request.user,
                "project.stage_auto_team_building",
                "Project",
                project.pk,
                before=before_project,
                after=project_detail_payload(project),
            )
        item.project.refresh_from_db()
        after = interaction_payload(type, item)
        audit(
            request.user,
            "interaction.review",
            item.__class__.__name__,
            item.pk,
            before=before,
            after={**after, "review_note": payload.review_note or "", "previous_project_stage": previous_project_stage},
        )
    return ok(after)


@api.patch("/me/interactions/{type}/{interaction_id}/withdraw/", response={200: Envelope, 401: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Me"])
def me_interaction_withdraw(request, type: str, interaction_id: int, payload: InteractionWithdrawRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    item = get_interaction_or_404(type, interaction_id, user=request.user)
    before = interaction_payload(type, item)
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
    title = payload.title.strip()
    if not title:
        return fail("Contribution title is required.", status=422, code="validation_error")
    result_type = payload.result_type or Contribution.ResultType.STAGE
    if result_type not in Contribution.ResultType.values:
        return fail("Invalid contribution result type.", status=422, code="validation_error")
    project = get_object_or_404(Project.objects.select_related("theme"), pk=payload.project_id, is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
    if project.stage != ProjectStage.ACTIVE:
        return fail("Project is not active.", status=422, code="project_not_active")
    if not user_has_approved_project_relation(request.user, project):
        return fail("Only approved participants can submit task results.", status=403, code="interaction_not_approved")
    task = None
    if payload.task_id:
        task = get_object_or_404(ProjectTask.objects.select_related("project", "project__theme", "assignee"), pk=payload.task_id, assignee=request.user)
        if task.project_id != project.id:
            return fail("Task does not belong to this project.", status=422, code="validation_error")
    with transaction.atomic():
        contribution = Contribution.objects.create(
            user=request.user,
            project=project,
            task=task,
            title=title,
            result_type=result_type,
            description=payload.description or "",
            file_path=payload.file_path or "",
        )
        if task and task.status != ProjectTask.TaskStatus.REVIEW:
            before = task_payload(task)
            task.status = ProjectTask.TaskStatus.REVIEW
            task.save(update_fields=["status", "updated_at"])
            audit(request.user, "task.submit_for_review", "ProjectTask", task.pk, before=before, after=task_payload(task))
        audit(request.user, "contribution.submit", "Contribution", contribution.pk, after=contribution_payload(contribution))
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


@api.get("/admin/themes/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_theme_list(request):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    themes = Theme.objects.order_by("sort_order", "name")
    return ok({"results": [theme_payload(theme) for theme in themes]})


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
        file_space={**DEFAULT_THEME_FILE_SPACE, **(data.get("file_space") or {})},
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
    if "file_space" in data:
        theme.file_space = {**DEFAULT_THEME_FILE_SPACE, **(data["file_space"] or {})}
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
    theme.is_active = False
    theme.save(update_fields=["is_active", "updated_at"])
    audit(request.user, "theme.deactivate", "Theme", theme.id, before=before, after=theme_payload(theme))
    return ok(theme_payload(theme))


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
    if not title or not path:
        return fail("title and path are required.", status=422, code="validation_error")
    if ThemeFile.objects.filter(theme=theme, path=path).exists():
        return fail("Theme file path already exists.", status=422, code="validation_error")
    file = ThemeFile.objects.create(
        theme=theme,
        section=(data.get("section") or "数据集文件").strip(),
        file_type=normalize_theme_file_type(data.get("file_type")),
        title=title,
        description=data.get("description", ""),
        path=path,
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
    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            return fail("title is required.", status=422, code="validation_error")
        file.title = title
    if "path" in data:
        path = (data.get("path") or "").strip()
        if not path:
            return fail("path is required.", status=422, code="validation_error")
        if ThemeFile.objects.filter(theme=file.theme, path=path).exclude(pk=file.pk).exists():
            return fail("Theme file path already exists.", status=422, code="validation_error")
        file.path = path
    for field in ["section", "description", "sort_order", "is_active"]:
        if field in data:
            setattr(file, field, data[field])
    if "file_type" in data:
        file.file_type = normalize_theme_file_type(data.get("file_type"))
    file.save()
    audit(request.user, "theme_file.update", "ThemeFile", file.id, before=before, after=theme_file_payload(file))
    return ok(theme_file_payload(file))


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


@api.get("/admin/file-space/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_file_space_list(request, theme_id: int, path: str = ""):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    theme = get_object_or_404(Theme, pk=theme_id)
    try:
        root = theme_file_space_root(theme)
        directory = safe_file_space_path(theme, path, expect_parent=False)
    except ValueError as exc:
        return fail(str(exc), status=422, code="invalid_file_space_path")
    if not directory.exists():
        directory.mkdir(parents=True, exist_ok=True)
    if not directory.is_dir():
        return fail("Path is not a directory.", status=422, code="not_directory")
    entries = [file_space_entry(item, root) for item in sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))]
    return ok(
        {
            "theme": theme_payload(theme),
            "base_root": str(file_space_base_root()),
            "root_path": str(root),
            "relative_path": relative_file_space_path(directory, root),
            "breadcrumbs": file_space_breadcrumbs(directory, root),
            "entries": entries,
        }
    )


@api.get("/admin/file-space/file/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_file_space_read_file(request, theme_id: int, path: str):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    theme = get_object_or_404(Theme, pk=theme_id)
    try:
        root = theme_file_space_root(theme)
        file_path = safe_file_space_path(theme, path, expect_parent=False)
    except ValueError as exc:
        return fail(str(exc), status=422, code="invalid_file_space_path")
    if not file_path.exists() or not file_path.is_file():
        raise Http404("File not found")
    if file_path.stat().st_size > 1024 * 1024:
        return fail("File is too large to edit online.", status=422, code="file_too_large")
    try:
        content = file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return fail("Only UTF-8 text files can be edited online.", status=422, code="binary_file")
    return ok({"entry": file_space_entry(file_path, root), "content": content})


@api.patch("/admin/themes/{theme_id}/file-space-root/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_theme_file_space_root_update(request, theme_id: int, payload: FileSpaceRootRequest):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    theme = get_object_or_404(Theme, pk=theme_id)
    before = theme_payload(theme)
    raw_directory = payload.server_directory.strip()
    try:
        resolved = resolve_file_space_root(raw_directory, theme)
    except ValueError as exc:
        return fail(str(exc), status=422, code="invalid_file_space_root")
    resolved.mkdir(parents=True, exist_ok=True)
    file_space = dict(theme.file_space or {})
    file_space["server_directory"] = str(resolved)
    theme.file_space = {**DEFAULT_THEME_FILE_SPACE, **file_space}
    theme.save(update_fields=["file_space", "updated_at"])
    audit(request.user, "theme.file_space_root.update", "Theme", theme.id, before=before, after=theme_payload(theme))
    return ok({"theme": theme_payload(theme), "root_path": str(resolved), "base_root": str(file_space_base_root())})


@api.post("/admin/file-space/directories/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_file_space_create_directory(request, payload: FileSpaceDirectoryRequest):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    theme = get_object_or_404(Theme, pk=payload.theme_id)
    name = sanitize_file_name(payload.name)
    if not name:
        return fail("Directory name is required.", status=422, code="validation_error")
    try:
        root = theme_file_space_root(theme)
        directory = safe_file_space_path(theme, f"{payload.path or ''}/{name}", expect_parent=True)
    except ValueError as exc:
        return fail(str(exc), status=422, code="invalid_file_space_path")
    directory.mkdir(parents=True, exist_ok=True)
    audit(request.user, "file_space.directory.create", "Theme", theme.id, after={"path": relative_file_space_path(directory, root)})
    return 201, ok({"entry": file_space_entry(directory, root)})


@api.post("/admin/file-space/files/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_file_space_create_file(request, payload: FileSpaceFileRequest):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    theme = get_object_or_404(Theme, pk=payload.theme_id)
    name = sanitize_file_name(payload.name)
    if not name:
        return fail("File name is required.", status=422, code="validation_error")
    try:
        root = theme_file_space_root(theme)
        file_path = safe_file_space_path(theme, f"{payload.path or ''}/{name}", expect_parent=True)
    except ValueError as exc:
        return fail(str(exc), status=422, code="invalid_file_space_path")
    if file_path.exists():
        return fail("File already exists.", status=422, code="file_exists")
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(payload.content or "", encoding="utf-8")
    upsert_theme_file_for_path(theme, file_path, root)
    audit(request.user, "file_space.file.create", "Theme", theme.id, after={"path": relative_file_space_path(file_path, root)})
    return 201, ok({"entry": file_space_entry(file_path, root)})


@api.patch("/admin/file-space/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_file_space_update(request, payload: FileSpaceUpdateRequest):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    theme = get_object_or_404(Theme, pk=payload.theme_id)
    try:
        root = theme_file_space_root(theme)
        target = safe_file_space_path(theme, payload.path, expect_parent=False)
    except ValueError as exc:
        return fail(str(exc), status=422, code="invalid_file_space_path")
    if not target.exists():
        raise Http404("File space item not found")
    before = {"path": relative_file_space_path(target, root)}
    if payload.content is not None:
        if not target.is_file():
            return fail("Only files can be edited.", status=422, code="not_file")
        target.write_text(payload.content, encoding="utf-8")
    if payload.new_name:
        new_name = sanitize_file_name(payload.new_name)
        if not new_name:
            return fail("New name is invalid.", status=422, code="validation_error")
        destination = safe_file_space_path(theme, f"{Path(payload.path).parent.as_posix()}/{new_name}", expect_parent=True)
        if destination.exists() and destination != target:
            return fail("Destination already exists.", status=422, code="file_exists")
        target.rename(destination)
        sync_theme_file_after_rename(theme, target, destination, root)
        target = destination
    elif target.is_file():
        upsert_theme_file_for_path(theme, target, root)
    after = {"path": relative_file_space_path(target, root)}
    audit(request.user, "file_space.update", "Theme", theme.id, before=before, after=after)
    return ok({"entry": file_space_entry(target, root)})


@api.delete("/admin/file-space/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_file_space_delete(request, payload: FileSpaceDeleteRequest):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    theme = get_object_or_404(Theme, pk=payload.theme_id)
    try:
        root = theme_file_space_root(theme)
        target = safe_file_space_path(theme, payload.path, expect_parent=False)
    except ValueError as exc:
        return fail(str(exc), status=422, code="invalid_file_space_path")
    if not target.exists():
        raise Http404("File space item not found")
    before = {"path": relative_file_space_path(target, root), "type": "directory" if target.is_dir() else "file"}
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
        deactivate_theme_file_for_path(theme, public_file_space_path(target))
    audit(request.user, "file_space.delete", "Theme", theme.id, before=before)
    return ok({"deleted": True, "path": before["path"]})


@api.post("/admin/file-space/upload/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_file_space_upload(request):
    auth_error = require_capability(request, "manage_themes")
    if auth_error:
        return auth_error
    theme_id = request.POST.get("theme_id")
    path = request.POST.get("path", "")
    if not theme_id:
        return fail("theme_id is required.", status=422, code="validation_error")
    theme = get_object_or_404(Theme, pk=theme_id)
    files = request.FILES.getlist("files")
    relative_paths = request.POST.getlist("relative_paths")
    if not files:
        return fail("No files uploaded.", status=422, code="validation_error")
    try:
        root = theme_file_space_root(theme)
        directory = safe_file_space_path(theme, path, expect_parent=True)
    except ValueError as exc:
        return fail(str(exc), status=422, code="invalid_file_space_path")
    directory.mkdir(parents=True, exist_ok=True)
    saved = []
    for index, uploaded in enumerate(files):
        relative_name = relative_paths[index] if index < len(relative_paths) else uploaded.name
        relative_name = safe_relative_upload_path(relative_name or uploaded.name)
        destination = safe_child_path(directory, relative_name, root)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as output:
            for chunk in uploaded.chunks():
                output.write(chunk)
        upsert_theme_file_for_path(theme, destination, root)
        saved.append(file_space_entry(destination, root))
    audit(request.user, "file_space.upload", "Theme", theme.id, after={"count": len(saved), "path": relative_file_space_path(directory, root)})
    return 201, ok({"saved": saved})


@api.get("/admin/projects/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_project_list(
    request,
    q: str = "",
    theme: str = "",
    stage: str = "",
    is_public: str = "",
    topic_id: str = "",
    source_md_path: str = "",
    content_hash: str = "",
    page: int = 1,
    page_size: int = 20,
):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    projects = project_stat_annotations(Project.objects.all().select_related("theme").prefetch_related("tags"))
    q = q.strip()
    theme = theme.strip()
    stage = stage.strip()
    is_public = is_public.strip().lower()
    topic_id = topic_id.strip()
    source_md_path = source_md_path.strip()
    content_hash = content_hash.strip()
    if q:
        projects = projects.filter(
            project_search_q(q)
            | Q(source_md_path__icontains=q)
        ).distinct()
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
    if source_md_path:
        projects = projects.filter(source_md_path=source_md_path)
    if content_hash:
        projects = projects.filter(content_hash=content_hash)
    projects = projects.order_by("-updated_at", "topic_id")
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


@api.get("/admin/projects/{project_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Admin"])
def admin_project_get(request, project_id: int):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    project = get_object_or_404(Project.objects.select_related("theme").prefetch_related("tags", "documents"), pk=project_id)
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
        return error
    data["stage"] = ProjectStage.DRAFT
    data["is_public"] = False
    if Project.objects.filter(topic_id=data["topic_id"]).exists():
        return fail("id already exists.", status=422, code="validation_error")
    try:
        project = create_project(data, source_label="api-admin", allow_create_theme=False)
    except ValueError as exc:
        return fail(str(exc), status=422, code="validation_error")
    project = get_object_or_404(Project.objects.select_related("theme").prefetch_related("tags", "documents"), pk=project.pk)
    audit(request.user, "project.create", "Project", project.id, after=project_detail_payload(project))
    return 201, ok(project_detail_payload(project))


@api.patch("/admin/projects/{project_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_project_update(request, project_id: int, payload: ProjectWriteRequest):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    project = get_object_or_404(Project.objects.select_related("theme").prefetch_related("tags", "documents"), pk=project_id)
    before = project_detail_payload(project)
    patch_data = payload.model_dump(exclude_unset=True, exclude_none=True)
    normalize_project_identity_alias(patch_data)
    if "topic_id" in patch_data and patch_data["topic_id"] != project.topic_id:
        return fail("topic_id cannot be changed.", status=422, code="validation_error")
    data = project_import_payload(project)
    data.update(patch_data)
    data["topic_id"] = project.topic_id
    error = validate_admin_project_payload(data, creating=False, current_project=project)
    if error:
        return error
    try:
        project = update_project(project, data, source_label="api-admin", allow_create_theme=False)
    except ValueError as exc:
        return fail(str(exc), status=422, code="validation_error")
    project = get_object_or_404(Project.objects.select_related("theme").prefetch_related("tags", "documents"), pk=project.pk)
    audit(request.user, "project.update", "Project", project.id, before=before, after=project_detail_payload(project))
    return ok(project_detail_payload(project))


@api.delete("/admin/projects/{project_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Admin"])
def admin_project_delete(request, project_id: int):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    project = get_object_or_404(Project.objects.select_related("theme").prefetch_related("tags", "documents"), pk=project_id)
    before = project_detail_payload(project)
    project.is_public = False
    project.stage = ProjectStage.ARCHIVED
    project.save(update_fields=["is_public", "stage", "updated_at"])
    audit(request.user, "project.archive", "Project", project.id, before=before, after=project_detail_payload(project))
    return ok(project_detail_payload(project))


@api.post("/projects/{project_id}/follow/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Interactions"])
def follow_project(request, project_id: int):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id, is_public=True, stage__in=FOLLOWABLE_PROJECT_STAGES)
    ProjectFollow.objects.get_or_create(user=request.user, project=project)
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
    return ok(score_payload(score))


@api.post("/projects/{project_id}/interest/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Interactions"])
def interest_project(request, project_id: int, payload: InterestRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id, is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
    if project.stage not in RECRUITING_PROJECT_STAGES:
        return fail("Project is not recruiting.", status=422, code="project_not_recruiting")
    form = ProjectInterestForm(payload.model_dump())
    if not form.is_valid():
        return fail("Interest submit failed.", status=422, code="validation_error", errors=form_errors(form))
    interest, _ = ProjectInterest.objects.update_or_create(
        user=request.user,
        project=project,
        role=form.cleaned_data["role"],
        defaults={
            "available_hours_per_week": form.cleaned_data["available_hours_per_week"],
            "experience": form.cleaned_data.get("experience", ""),
            "message": form.cleaned_data.get("message", ""),
            "status": InteractionStatus.PENDING,
        },
    )
    return 201, ok(interest_payload(interest))


@api.post("/projects/{project_id}/claim/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Interactions"])
def claim_project(request, project_id: int, payload: ClaimRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id, is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
    if project.stage not in RECRUITING_PROJECT_STAGES:
        return fail("Project is not recruiting.", status=422, code="project_not_recruiting")
    form = ProjectClaimIntentForm(payload.model_dump())
    if not form.is_valid():
        return fail("Claim submit failed.", status=422, code="validation_error", errors=form_errors(form))
    claim, _ = ProjectClaimIntent.objects.update_or_create(
        user=request.user,
        project=project,
        claim_type=form.cleaned_data["claim_type"],
        defaults={"message": form.cleaned_data.get("message", ""), "status": InteractionStatus.PENDING},
    )
    return 201, ok(claim_payload(claim))


@api.post("/projects/{project_id}/sponsor/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Interactions"])
def sponsor_project(request, project_id: int, payload: SponsorRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id, is_public=True, stage__in=PUBLIC_PROJECT_STAGES)
    if project.stage not in RECRUITING_PROJECT_STAGES:
        return fail("Project is not recruiting.", status=422, code="project_not_recruiting")
    form = SponsorIntentForm(payload.model_dump())
    if not form.is_valid():
        return fail("Sponsor intent submit failed.", status=422, code="validation_error", errors=form_errors(form))
    sponsor, _ = SponsorIntent.objects.update_or_create(
        user=request.user,
        project=project,
        sponsor_type=form.cleaned_data["sponsor_type"],
        defaults={"note": form.cleaned_data.get("note", ""), "status": InteractionStatus.PENDING},
    )
    return 201, ok(sponsor_payload(sponsor))


def ok(data=None):
    return {"ok": True, "data": data}


def fail(message, status=400, code="bad_request", errors=None):
    return status, error_payload(message, code, errors)


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
    payload = {"ok": False, "error": {"code": code, "message": message}}
    if errors is not None:
        payload["error"]["details"] = errors
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
        return fail("Permission denied.", status=403, code="permission_denied")
    return None


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

    def add_uid(group_type, key, label, uid, sort_key):
        if not uid:
            return
        group = grouped.setdefault(
            key,
            {
                "key": key,
                "type": group_type,
                "label": label,
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
        add_uid("interest", key, label, profile_uid_for(interest.user), (1, status_order.get(interest.status, 99), label))

    claim_rows = ProjectClaimIntent.objects.filter(project=project).select_related("user__profile").order_by("status", "claim_type")
    for claim in claim_rows:
        key = f"claim-{claim.claim_type}-{claim.status}"
        label = f"{claim.get_claim_type_display()}（{claim.get_status_display()}）"
        add_uid("claim", key, label, profile_uid_for(claim.user), (2, status_order.get(claim.status, 99), label))

    sponsor_rows = SponsorIntent.objects.filter(project=project).select_related("user__profile").order_by("status", "sponsor_type")
    for sponsor in sponsor_rows:
        key = f"sponsor-{sponsor.sponsor_type}-{sponsor.status}"
        label = f"资助：{sponsor.get_sponsor_type_display()}（{sponsor.get_status_display()}）"
        add_uid("sponsor", key, label, profile_uid_for(sponsor.user), (3, status_order.get(sponsor.status, 99), label))

    groups = []
    for group in sorted(grouped.values(), key=lambda item: item["sort_key"]):
        uids = sorted(group["uids"])
        groups.append(
            {
                "key": group["key"],
                "type": group["type"],
                "label": group["label"],
                "count": len(uids),
                "uids": uids,
            }
        )
    return {"uids_visible": True, "groups": groups}


def pending_interaction_count():
    return (
        ProjectInterest.objects.filter(status=InteractionStatus.PENDING).count()
        + ProjectClaimIntent.objects.filter(status=InteractionStatus.PENDING).count()
        + SponsorIntent.objects.filter(status=InteractionStatus.PENDING).count()
    )


def user_has_approved_project_relation(user, project):
    filters = {"user": user, "project": project, "status": InteractionStatus.APPROVED}
    return (
        ProjectInterest.objects.filter(**filters).exists()
        or ProjectClaimIntent.objects.filter(**filters).exists()
        or SponsorIntent.objects.filter(**filters).exists()
    )


def interaction_kinds(type_filter=""):
    valid = ["interest", "claim", "sponsor"]
    if not type_filter:
        return valid
    return [type_filter] if type_filter in valid else []


def interaction_queryset(kind):
    model = interaction_model(kind)
    return (
        model.objects.select_related("user", "user__profile", "project", "project__theme")
        .prefetch_related("project__tags")
        .order_by("-updated_at")
    )


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
        detail = {}
    else:
        subtype = item.sponsor_type
        subtype_label = item.get_sponsor_type_display()
        message = item.note
        detail = {}
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
    activity_labels = []
    if is_following:
        activity_labels.append("已收藏")
    activity_labels.extend(
        f"参与：{interest.get_role_display()}（{interest.get_status_display()}）" for interest in interests
    )
    activity_labels.extend(f"{claim.get_claim_type_display()}（{claim.get_status_display()}）" for claim in claims)
    activity_labels.extend(f"资助：{sponsor.get_sponsor_type_display()}（{sponsor.get_status_display()}）" for sponsor in sponsors)
    profile = getattr(user, "profile", None)
    return {
        "uid": getattr(profile, "uid", None),
        "is_following": is_following,
        "score": score_payload(score) if score else None,
        "interest_roles": [interest.role for interest in interests],
        "claim_types": [claim.claim_type for claim in claims],
        "sponsor_types": [sponsor.sponsor_type for sponsor in sponsors],
        "activity_labels": activity_labels,
    }


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


def validate_admin_project_payload(data, creating, current_project=None):
    topic_id = normalize_project_topic_id(data.get("topic_id"))
    title = (data.get("title") or "").strip()
    if not topic_id or not title:
        return fail("id and title are required.", status=422, code="validation_error")
    data["topic_id"] = topic_id
    data["title"] = title

    for field, label in [
        ("problem_statement", "科学问题"),
        ("clinical_endpoint", "临床终点"),
        ("existing_foundation", "已有基础"),
    ]:
        value = str(data.get(field) or "").strip()
        if not value:
            return fail(f"{label} is required.", status=422, code="validation_error")
        if len(value) > 50:
            return fail(f"{label} must be within 50 characters.", status=422, code="validation_error")
        data[field] = value

    theme = data.get("theme")
    if isinstance(theme, dict):
        theme_name = (theme.get("name") or theme.get("slug") or "").strip()
    else:
        theme_name = str(theme or "").strip()
    if not theme_name:
        return fail("theme is required.", status=422, code="validation_error")
    theme_obj = theme_from_payload(data, current=current_project.theme if current_project else None)
    if theme_obj is None:
        return fail("theme does not exist.", status=422, code="validation_error")

    stage = data.get("stage")
    stage_labels = {label for _, label in ProjectStage.choices}
    if stage and stage not in ProjectStage.values and stage not in stage_labels:
        return fail("stage is invalid.", status=422, code="validation_error")
    return None


def normalize_project_identity_alias(data):
    if "id" in data and "topic_id" not in data:
        data["topic_id"] = data.pop("id")
    else:
        data.pop("id", None)


def normalize_project_topic_id(value):
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not text.isdigit():
        return None
    number = int(text)
    return number if number > 0 else None


def project_search_q(value):
    text = str(value or "").strip()
    query = (
        Q(title__icontains=text)
        | Q(title_en__icontains=text)
        | Q(summary__icontains=text)
        | Q(problem_statement__icontains=text)
        | Q(clinical_endpoint__icontains=text)
        | Q(existing_foundation__icontains=text)
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
        "research_goal": project.research_goal,
        "technical_route": project.technical_route,
        "data_requirements": project.data_requirements,
        "evaluation_metrics": project.evaluation_metrics,
        "expected_outputs": project.expected_outputs,
        "compliance_notes": project.compliance_notes,
        "body_markdown": project.body_markdown,
        "stage": project.stage,
        "tags": [tag.name for tag in project.tags.all()],
        "llm_score": float(project.llm_score) if project.llm_score is not None else None,
        "community_score": float(project.community_score) if project.community_score is not None else None,
        "composite_score": float(project.composite_score) if project.composite_score is not None else None,
        "recommended_journal": project.recommended_journal,
        "needed_roles": project.needed_roles,
        "score_dimensions": project.score_dimensions,
        "source_md_path": project.source_md_path,
        "source_pdf_path": project.source_pdf_path,
        "page_path": project.page_path,
        "documents": [document_payload(document) for document in project.documents.all()],
        "has_pdf": project.has_pdf,
        "is_public": project.is_public,
    }


def document_payload(document):
    return {
        "doc_type": document.doc_type,
        "title": document.title,
        "path": document.path,
        "content_hash": document.content_hash,
    }


def file_space_base_root():
    root = Path(getattr(settings, "OPENMEDAILAB_FILE_SPACE_ROOT", settings.MEDIA_ROOT / "theme-file-space"))
    return root.expanduser().resolve()


def resolve_file_space_root(raw_directory, theme):
    base = file_space_base_root()
    value = (raw_directory or "").strip() or theme.slug
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = base / candidate
    candidate = candidate.resolve()
    if candidate != base and base not in candidate.parents:
        raise ValueError(f"文件空间目录必须位于 {base} 之下。")
    return candidate


def theme_file_space_root(theme):
    file_space = theme.file_space if isinstance(theme.file_space, dict) else {}
    return resolve_file_space_root(file_space.get("server_directory") or theme.slug, theme)


def safe_file_space_path(theme, relative_path, expect_parent=False):
    root = theme_file_space_root(theme)
    root.mkdir(parents=True, exist_ok=True)
    return safe_child_path(root, relative_path or "", root, expect_parent=expect_parent)


def safe_child_path(parent, relative_path, root, expect_parent=False):
    raw = str(relative_path or "").replace("\\", "/").strip("/")
    if "\x00" in raw:
        raise ValueError("文件路径不合法。")
    candidate = (parent / raw).resolve() if raw else parent.resolve()
    check = candidate.parent if expect_parent else candidate
    if check != root and root not in check.parents:
        raise ValueError("文件路径不能超出文件空间根目录。")
    return candidate


def safe_relative_upload_path(relative_path):
    parts = [sanitize_file_name(part) for part in str(relative_path or "").replace("\\", "/").split("/") if part not in {"", ".", ".."}]
    return "/".join(part for part in parts if part)


def sanitize_file_name(name):
    value = str(name or "").replace("\\", "/").split("/")[-1].strip()
    if value in {"", ".", ".."} or "\x00" in value:
        return ""
    return value


def relative_file_space_path(path, root):
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return ""


def file_space_breadcrumbs(path, root):
    relative = relative_file_space_path(path, root)
    breadcrumbs = [{"name": "根目录", "path": ""}]
    current = []
    for part in [item for item in relative.split("/") if item]:
        current.append(part)
        breadcrumbs.append({"name": part, "path": "/".join(current)})
    return breadcrumbs


def file_space_entry(path, root):
    stat = path.stat()
    relative = relative_file_space_path(path, root)
    is_dir = path.is_dir()
    return {
        "name": path.name,
        "path": relative,
        "type": "directory" if is_dir else "file",
        "size": None if is_dir else stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "mime_type": "" if is_dir else (mimetypes.guess_type(path.name)[0] or "application/octet-stream"),
        "public_path": "" if is_dir else public_file_space_path(path),
    }


def public_file_space_path(path):
    media_root = Path(settings.MEDIA_ROOT).expanduser().resolve()
    try:
        return f"{settings.MEDIA_URL.rstrip('/')}/{path.resolve().relative_to(media_root).as_posix()}"
    except ValueError:
        return str(path)


def theme_file_section_for_path(path):
    parent = path.parent.name
    return parent if parent and parent != path.name else "数据集文件"


def theme_file_type_for_path(path):
    mime_type = mimetypes.guess_type(path.name)[0] or ""
    suffix = path.suffix.lower()
    if mime_type.startswith("text/") or suffix in {".csv", ".tsv", ".xlsx", ".xls", ".json", ".parquet"}:
        return ThemeFile.FileType.DATASET
    if suffix in {".md", ".txt", ".pdf", ".doc", ".docx"}:
        return ThemeFile.FileType.DATASET_META
    return ThemeFile.FileType.OTHER


def upsert_theme_file_for_path(theme, path, root):
    public_path = public_file_space_path(path)
    title = path.stem or path.name
    file, _ = ThemeFile.objects.get_or_create(
        theme=theme,
        path=public_path,
        defaults={
            "section": theme_file_section_for_path(path),
            "file_type": theme_file_type_for_path(path),
            "title": title,
            "description": "",
            "is_active": True,
        },
    )
    if not file.is_active or file.title != title:
        file.title = title
        file.is_active = True
        file.section = file.section or theme_file_section_for_path(path)
        file.file_type = file.file_type or theme_file_type_for_path(path)
        file.save(update_fields=["title", "section", "file_type", "is_active", "updated_at"])
    return file


def sync_theme_file_after_rename(theme, old_path, new_path, root):
    old_public_path = public_file_space_path(old_path)
    new_public_path = public_file_space_path(new_path)
    ThemeFile.objects.filter(theme=theme, path=old_public_path).update(path=new_public_path, title=new_path.stem or new_path.name, is_active=True)
    if new_path.is_file():
        upsert_theme_file_for_path(theme, new_path, root)


def deactivate_theme_file_for_path(theme, public_path):
    ThemeFile.objects.filter(theme=theme, path=public_path).update(is_active=False)


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


def audit(actor, action, target_type, target_id, before=None, after=None):
    AuditLog.objects.create(
        actor=actor if actor and actor.is_authenticated else None,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        before=json_safe(before or {}),
        after=json_safe(after or {}),
    )


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
