from typing import Any, Optional

from django.contrib.auth import authenticate, login, logout
from django.core.paginator import Paginator
from django.db.models import Q
from django.http import Http404
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError, ValidationError
from ninja.security import SessionAuth

from accounts.forms import RegisterForm, UserProfileForm
from accounts.models import RoleType
from credits.models import CreditLedger
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
from projects.models import Project, ProjectStage, Tag, Theme

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
    theme_payload,
    user_payload,
)


api = NinjaAPI(
    title="OpenMedAILab API",
    version="0.1.0",
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
        }
    )


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
    user = form.save()
    CreditLedger.objects.create(
        user=user,
        action_type=CreditLedger.ActionType.REGISTER_BONUS,
        amount=user.profile.credit_balance,
        balance_after=user.profile.credit_balance,
        reason="注册初始积分",
    )
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


def error_payload(message, code="bad_request", errors=None):
    payload = {"ok": False, "error": {"code": code, "message": message}}
    if errors is not None:
        payload["error"]["details"] = errors
    return payload


def require_login(request):
    if not request.user.is_authenticated:
        return fail("Authentication required.", status=401, code="auth_required")
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
