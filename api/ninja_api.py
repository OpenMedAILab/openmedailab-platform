from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.forms import SetPasswordForm
from django.contrib.auth.models import User
from django.core.paginator import Paginator
from django.db.models import Q
from django.http import Http404
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils.text import slugify
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError, ValidationError
from ninja.security import SessionAuth

from config.release import APP_VERSION, release_payload
from accounts.forms import RegisterForm, UserProfileForm
from accounts.models import RoleType, UserProfile
from accounts.services import (
    DefaultPasswordConfigError,
    create_registered_user,
    get_system_default_password,
    reset_user_to_default_password,
)
from interactions.forms import ProjectClaimIntentForm, ProjectInterestForm, ProjectScoreForm, SponsorIntentForm
from interactions.models import (
    ClaimType,
    ParticipationRole,
    ProjectClaimIntent,
    ProjectFollow,
    ProjectInterest,
    ProjectScore,
    SponsorIntent,
    SponsorType,
)
from interactions.services import project_stat_annotations, recalculate_project_community_score
from projects.contracts import DEFAULT_THEME_FILE_SPACE, PROJECT_FIELD_CONTRACT, PROJECT_JSON_EXAMPLE
from projects.importing import import_topic_bundle, unique_slug, upsert_project
from projects.models import AuditLog, Project, ProjectDocument, ProjectStage, Tag, Theme, ThemeFile

from .rbac import capabilities_for_user, has_capability
from .responses import form_errors
from .serializers import (
    claim_payload,
    dashboard_payload,
    interest_payload,
    project_detail_payload,
    project_summary_payload,
    score_payload,
    sponsor_payload,
    tag_payload,
    theme_file_payload,
    theme_payload,
    theme_space_payload,
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
    topic_id: Optional[str] = None
    theme: Optional[Any] = None
    project_no: Optional[int] = None
    title: Optional[str] = None
    summary: Optional[str] = ""
    problem_statement: Optional[str] = ""
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
    documents: Optional[list[dict[str, Any]]] = None
    has_pdf: Optional[bool] = None
    is_public: Optional[bool] = True


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


class ProjectImportRequest(Schema):
    themes: Optional[list[dict[str, Any]]] = []
    projects: list[dict[str, Any]]
    dry_run: bool = False


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
            "example": PROJECT_JSON_EXAMPLE,
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
            Project.objects.filter(theme=theme, is_public=True).select_related("theme").prefetch_related("tags")
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
    projects = project_stat_annotations(Project.objects.filter(is_public=True).select_related("theme").prefetch_related("tags"))
    q = q.strip()
    theme = theme.strip()
    tag = tag.strip()
    stage = stage.strip()
    has_pdf = has_pdf.strip()

    if q:
        projects = projects.filter(Q(title__icontains=q) | Q(summary__icontains=q) | Q(topic_id__icontains=q) | Q(tags__name__icontains=q)).distinct()
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
        "project_no": ("theme__name", "project_no", "topic_id"),
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
        project_stat_annotations(Project.objects.filter(is_public=True).select_related("theme").prefetch_related("tags", "documents")),
        pk=project_id,
    )
    data = project_detail_payload(project)
    if request.user.is_authenticated:
        data["viewer_state"] = viewer_state(request.user, project)
    return ok(data)


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
    return ok(dashboard_payload(request.user, follows, interests, claims, sponsors, scores))


@api.get("/admin/users/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_user_list(request, q: str = "", page: int = 1, page_size: int = 50):
    auth_error = require_capability(request, "manage_users")
    if auth_error:
        return auth_error
    users = User.objects.select_related("profile").order_by("id")
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


@api.get("/admin/projects/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope}, tags=["Admin"])
def admin_project_list(request, q: str = "", theme: str = "", page: int = 1, page_size: int = 20):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    projects = project_stat_annotations(Project.objects.all().select_related("theme").prefetch_related("tags"))
    q = q.strip()
    theme = theme.strip()
    if q:
        projects = projects.filter(Q(title__icontains=q) | Q(summary__icontains=q) | Q(topic_id__icontains=q)).distinct()
    if theme:
        projects = projects.filter(Q(theme__slug=theme) | Q(theme__name=theme))
    projects = projects.order_by("-updated_at", "topic_id")
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
        }
    )


@api.post("/admin/projects/import-json/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_project_import_json(request, payload: ProjectImportRequest):
    auth_error = require_capability(request, "import_projects")
    if auth_error:
        return auth_error
    try:
        result = import_topic_bundle(payload.model_dump(), source_label=f"api-json:{request.user.username}", dry_run=payload.dry_run)
    except Exception as exc:
        return fail(str(exc), status=422, code="validation_error")
    audit(request.user, "project.import_json", "Project", "bundle", after=result)
    return ok(result)


@api.get("/admin/projects/{project_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope}, tags=["Admin"])
def admin_project_get(request, project_id: int):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    project = get_object_or_404(Project.objects.select_related("theme").prefetch_related("tags", "documents"), pk=project_id)
    return ok(project_detail_payload(project))


@api.post("/admin/projects/", response={201: Envelope, 200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_project_create(request, payload: ProjectWriteRequest):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    data = payload.model_dump(exclude_none=True)
    if not data.get("topic_id") or not data.get("title"):
        return fail("topic_id and title are required.", status=422, code="validation_error")
    created = upsert_project(data, source_label="api-admin")
    project = get_object_or_404(Project.objects.select_related("theme").prefetch_related("tags", "documents"), topic_id=data["topic_id"])
    audit(request.user, "project.create" if created else "project.upsert", "Project", project.id, after=project_detail_payload(project))
    return (201 if created else 200), ok(project_detail_payload(project))


@api.patch("/admin/projects/{project_id}/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Admin"])
def admin_project_update(request, project_id: int, payload: ProjectWriteRequest):
    auth_error = require_capability(request, "manage_projects")
    if auth_error:
        return auth_error
    project = get_object_or_404(Project.objects.select_related("theme").prefetch_related("tags", "documents"), pk=project_id)
    before = project_detail_payload(project)
    data = project_import_payload(project)
    data.update(payload.model_dump(exclude_unset=True, exclude_none=True))
    created = upsert_project(data, source_label="api-admin")
    project = get_object_or_404(Project.objects.select_related("theme").prefetch_related("tags", "documents"), topic_id=data["topic_id"])
    audit(request.user, "project.update" if not created else "project.create", "Project", project.id, before=before, after=project_detail_payload(project))
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
    project = get_object_or_404(Project, pk=project_id, is_public=True)
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
    project = get_object_or_404(Project, pk=project_id, is_public=True)
    ProjectFollow.objects.filter(user=request.user, project=project).delete()
    return ok({"is_following": False})


@api.post("/projects/{project_id}/score/", response={200: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Interactions"])
def score_project(request, project_id: int, payload: ScoreRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id, is_public=True)
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
    project = get_object_or_404(Project, pk=project_id, is_public=True)
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
            "status": "pending",
        },
    )
    return 201, ok(interest_payload(interest))


@api.post("/projects/{project_id}/claim/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Interactions"])
def claim_project(request, project_id: int, payload: ClaimRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id, is_public=True)
    form = ProjectClaimIntentForm(payload.model_dump())
    if not form.is_valid():
        return fail("Claim submit failed.", status=422, code="validation_error", errors=form_errors(form))
    claim, _ = ProjectClaimIntent.objects.update_or_create(
        user=request.user,
        project=project,
        claim_type=form.cleaned_data["claim_type"],
        defaults={"message": form.cleaned_data.get("message", ""), "status": "pending"},
    )
    return 201, ok(claim_payload(claim))


@api.post("/projects/{project_id}/sponsor/", response={201: Envelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 422: ErrorEnvelope}, tags=["Interactions"])
def sponsor_project(request, project_id: int, payload: SponsorRequest):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=project_id, is_public=True)
    form = SponsorIntentForm(payload.model_dump())
    if not form.is_valid():
        return fail("Sponsor intent submit failed.", status=422, code="validation_error", errors=form_errors(form))
    sponsor, _ = SponsorIntent.objects.update_or_create(
        user=request.user,
        project=project,
        sponsor_type=form.cleaned_data["sponsor_type"],
        defaults={"note": form.cleaned_data.get("note", ""), "status": "pending"},
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


def viewer_state(user, project):
    score = ProjectScore.objects.filter(user=user, project=project).first()
    return {
        "is_following": ProjectFollow.objects.filter(user=user, project=project).exists(),
        "score": score_payload(score) if score else None,
        "interest_roles": list(ProjectInterest.objects.filter(user=user, project=project).values_list("role", flat=True)),
        "claim_types": list(ProjectClaimIntent.objects.filter(user=user, project=project).values_list("claim_type", flat=True)),
        "sponsor_types": list(SponsorIntent.objects.filter(user=user, project=project).values_list("sponsor_type", flat=True)),
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


def project_import_payload(project):
    return {
        "topic_id": project.topic_id,
        "theme": theme_payload(project.theme) if project.theme else "未分类",
        "project_no": project.project_no,
        "title": project.title,
        "summary": project.summary,
        "problem_statement": project.problem_statement,
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
