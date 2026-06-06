from django.contrib.auth import authenticate, login, logout
from django.core.paginator import Paginator
from django.db.models import Q
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST

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

from .responses import fail, form_errors, ok, parse_json
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


def require_login(request):
    if not request.user.is_authenticated:
        return fail("Authentication required.", status=401, code="auth_required")
    return None


def choice_payload(choices):
    return [{"value": value, "label": label} for value, label in choices]


@require_GET
def health(request):
    return ok({"status": "ok"})


@ensure_csrf_cookie
@require_GET
def csrf(request):
    return ok({"csrf_token": get_token(request)})


@require_GET
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


@require_GET
def me(request):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    return ok(user_payload(request.user))


@require_POST
def register(request):
    try:
        payload = parse_json(request)
    except ValueError as exc:
        return fail(str(exc), code="invalid_json")
    form = RegisterForm(payload)
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
    return ok(user_payload(user), status=201)


@require_POST
def login_view(request):
    try:
        payload = parse_json(request)
    except ValueError as exc:
        return fail(str(exc), code="invalid_json")
    username = payload.get("username", "")
    password = payload.get("password", "")
    user = authenticate(request, username=username, password=password)
    if user is None:
        return fail("用户名或密码错误。", status=400, code="invalid_credentials")
    login(request, user)
    return ok(user_payload(user))


@require_POST
def logout_view(request):
    logout(request)
    return ok({"logged_out": True})


@require_http_methods(["GET", "PUT", "PATCH"])
def profile(request):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    if request.method == "GET":
        return ok(user_payload(request.user))

    try:
        payload = parse_json(request)
    except ValueError as exc:
        return fail(str(exc), code="invalid_json")
    if request.method == "PATCH":
        current = profile_form_initial(request.user.profile)
        current.update(payload)
        payload = current
    form = UserProfileForm(payload, instance=request.user.profile)
    if not form.is_valid():
        return fail("Profile update failed.", status=422, code="validation_error", errors=form_errors(form))
    form.save()
    return ok(user_payload(request.user))


@require_GET
def project_list(request):
    projects = project_stat_annotations(Project.objects.filter(is_public=True).select_related("theme").prefetch_related("tags"))
    q = request.GET.get("q", "").strip()
    theme = request.GET.get("theme", "").strip()
    tag = request.GET.get("tag", "").strip()
    stage = request.GET.get("stage", "").strip()
    has_pdf = request.GET.get("has_pdf", "").strip()
    sort = request.GET.get("sort", "recommended")

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

    page_size = parse_int(request.GET.get("page_size"), default=20, minimum=1, maximum=100)
    paginator = Paginator(projects, page_size)
    page_obj = paginator.get_page(request.GET.get("page"))
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


@require_GET
def project_detail(request, pk):
    project = get_object_or_404(
        project_stat_annotations(Project.objects.filter(is_public=True).select_related("theme").prefetch_related("tags", "documents")),
        pk=pk,
    )
    data = project_detail_payload(project)
    if request.user.is_authenticated:
        data["viewer_state"] = viewer_state(request.user, project)
    return ok(data)


@require_GET
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


@require_POST
def follow_project(request, pk):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=pk, is_public=True)
    ProjectFollow.objects.get_or_create(user=request.user, project=project)
    return ok({"is_following": True})


@require_http_methods(["POST", "DELETE"])
def unfollow_project(request, pk):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=pk, is_public=True)
    ProjectFollow.objects.filter(user=request.user, project=project).delete()
    return ok({"is_following": False})


@require_POST
def score_project(request, pk):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=pk, is_public=True)
    form = ProjectScoreForm(payload_from_request(request))
    if not form.is_valid():
        return fail("Score submit failed.", status=422, code="validation_error", errors=form_errors(form))
    score, _ = ProjectScore.objects.update_or_create(
        user=request.user,
        project=project,
        defaults={"score": form.cleaned_data["score"], "comment": form.cleaned_data.get("comment", "")},
    )
    recalculate_project_community_score(project)
    return ok(score_payload(score))


@require_POST
def interest_project(request, pk):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=pk, is_public=True)
    form = ProjectInterestForm(payload_from_request(request))
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
    return ok(interest_payload(interest), status=201)


@require_POST
def claim_project(request, pk):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=pk, is_public=True)
    form = ProjectClaimIntentForm(payload_from_request(request))
    if not form.is_valid():
        return fail("Claim submit failed.", status=422, code="validation_error", errors=form_errors(form))
    claim, _ = ProjectClaimIntent.objects.update_or_create(
        user=request.user,
        project=project,
        claim_type=form.cleaned_data["claim_type"],
        defaults={"message": form.cleaned_data.get("message", ""), "status": "pending"},
    )
    return ok(claim_payload(claim), status=201)


@require_POST
def sponsor_project(request, pk):
    auth_error = require_login(request)
    if auth_error:
        return auth_error
    project = get_object_or_404(Project, pk=pk, is_public=True)
    form = SponsorIntentForm(payload_from_request(request))
    if not form.is_valid():
        return fail("Sponsor intent submit failed.", status=422, code="validation_error", errors=form_errors(form))
    sponsor, _ = SponsorIntent.objects.update_or_create(
        user=request.user,
        project=project,
        sponsor_type=form.cleaned_data["sponsor_type"],
        defaults={"note": form.cleaned_data.get("note", ""), "status": "pending"},
    )
    return ok(sponsor_payload(sponsor), status=201)


def viewer_state(user, project):
    score = ProjectScore.objects.filter(user=user, project=project).first()
    return {
        "is_following": ProjectFollow.objects.filter(user=user, project=project).exists(),
        "score": score_payload(score) if score else None,
        "interest_roles": list(ProjectInterest.objects.filter(user=user, project=project).values_list("role", flat=True)),
        "claim_types": list(ProjectClaimIntent.objects.filter(user=user, project=project).values_list("claim_type", flat=True)),
        "sponsor_types": list(SponsorIntent.objects.filter(user=user, project=project).values_list("sponsor_type", flat=True)),
    }


def payload_from_request(request):
    try:
        return parse_json(request)
    except ValueError:
        return {}


def parse_int(value, default, minimum=None, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    if minimum is not None:
        number = max(number, minimum)
    if maximum is not None:
        number = min(number, maximum)
    return number


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
