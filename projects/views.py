from django.contrib import messages
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse

from interactions.forms import ProjectClaimIntentForm, ProjectInterestForm, ProjectScoreForm, SponsorIntentForm
from interactions.models import ProjectClaimIntent, ProjectFollow, ProjectInterest, ProjectScore, SponsorIntent
from interactions.services import project_stat_annotations, recalculate_project_community_score

from .models import Project, ProjectStage, Tag, Theme


def home(request):
    stats = {
        "project_count": Project.objects.filter(is_public=True).count(),
        "theme_count": Theme.objects.filter(is_active=True).count(),
        "user_count": User.objects.count(),
        "follow_count": ProjectFollow.objects.count(),
        "interest_count": ProjectInterest.objects.count(),
        "score_count": ProjectScore.objects.count(),
    }
    themes = Theme.objects.filter(is_active=True).annotate(project_count=Count("projects")).order_by("sort_order", "name")[:12]
    hot_projects = project_stat_annotations(Project.objects.filter(is_public=True)).order_by("-follow_count", "-interest_count", "-composite_score")[:8]
    return render(request, "projects/home.html", {"stats": stats, "themes": themes, "hot_projects": hot_projects})


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

    paginator = Paginator(projects, 20)
    page_obj = paginator.get_page(request.GET.get("page"))
    context = {
        "page_obj": page_obj,
        "themes": Theme.objects.filter(is_active=True).order_by("sort_order", "name"),
        "tags": Tag.objects.order_by("name")[:80],
        "stages": ProjectStage.choices,
        "filters": {"q": q, "theme": theme, "tag": tag, "stage": stage, "has_pdf": has_pdf, "sort": sort},
    }
    return render(request, "projects/project_list.html", context)


def project_detail(request, pk):
    project = get_object_or_404(
        project_stat_annotations(Project.objects.select_related("theme").prefetch_related("tags", "documents")).filter(is_public=True),
        pk=pk,
    )
    user_state = {}
    if request.user.is_authenticated:
        user_state = {
            "is_following": ProjectFollow.objects.filter(user=request.user, project=project).exists(),
            "score": ProjectScore.objects.filter(user=request.user, project=project).first(),
            "interests": ProjectInterest.objects.filter(user=request.user, project=project),
            "claims": ProjectClaimIntent.objects.filter(user=request.user, project=project),
            "sponsors": SponsorIntent.objects.filter(user=request.user, project=project),
        }
    context = {
        "project": project,
        "team_status": project.team_status,
        "user_state": user_state,
        "score_form": ProjectScoreForm(instance=user_state.get("score")),
        "interest_form": ProjectInterestForm(),
        "claim_form": ProjectClaimIntentForm(),
        "sponsor_form": SponsorIntentForm(),
        "recent_interests": project.interests.select_related("user").order_by("-created_at")[:8],
        "recent_scores": project.scores.select_related("user").order_by("-updated_at")[:8],
    }
    return render(request, "projects/project_detail.html", context)


@login_required
def dashboard(request):
    context = {
        "profile": request.user.profile,
        "follows": ProjectFollow.objects.filter(user=request.user).select_related("project", "project__theme").order_by("-created_at"),
        "interests": ProjectInterest.objects.filter(user=request.user).select_related("project", "project__theme").order_by("-updated_at"),
        "claims": ProjectClaimIntent.objects.filter(user=request.user).select_related("project", "project__theme").order_by("-updated_at"),
        "sponsors": SponsorIntent.objects.filter(user=request.user).select_related("project", "project__theme").order_by("-updated_at"),
        "scores": ProjectScore.objects.filter(user=request.user).select_related("project", "project__theme").order_by("-updated_at"),
    }
    return render(request, "projects/dashboard.html", context)


def _project_redirect(project):
    return redirect(reverse("project_detail", args=[project.pk]))


@login_required
def follow_project(request, pk):
    project = get_object_or_404(Project, pk=pk, is_public=True)
    ProjectFollow.objects.get_or_create(user=request.user, project=project)
    messages.success(request, "已关注该课题。")
    return _project_redirect(project)


@login_required
def unfollow_project(request, pk):
    project = get_object_or_404(Project, pk=pk, is_public=True)
    ProjectFollow.objects.filter(user=request.user, project=project).delete()
    messages.success(request, "已取消关注。")
    return _project_redirect(project)


@login_required
def score_project(request, pk):
    project = get_object_or_404(Project, pk=pk, is_public=True)
    form = ProjectScoreForm(request.POST)
    if form.is_valid():
        ProjectScore.objects.update_or_create(
            user=request.user,
            project=project,
            defaults={"score": form.cleaned_data["score"], "comment": form.cleaned_data.get("comment", "")},
        )
        recalculate_project_community_score(project)
        messages.success(request, "评分已记录。")
    else:
        messages.error(request, "评分提交失败，请检查 1-10 分范围。")
    return _project_redirect(project)


@login_required
def interest_project(request, pk):
    project = get_object_or_404(Project, pk=pk, is_public=True)
    form = ProjectInterestForm(request.POST)
    if form.is_valid():
        ProjectInterest.objects.update_or_create(
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
        messages.success(request, "参与意向已记录，管理员可在后台查看。")
    else:
        messages.error(request, "参与意向提交失败，请检查表单。")
    return _project_redirect(project)


@login_required
def claim_project(request, pk):
    project = get_object_or_404(Project, pk=pk, is_public=True)
    form = ProjectClaimIntentForm(request.POST)
    if form.is_valid():
        ProjectClaimIntent.objects.update_or_create(
            user=request.user,
            project=project,
            claim_type=form.cleaned_data["claim_type"],
            defaults={"message": form.cleaned_data.get("message", ""), "status": "pending"},
        )
        messages.success(request, "认领意向已记录。")
    else:
        messages.error(request, "认领意向提交失败，请检查表单。")
    return _project_redirect(project)


@login_required
def sponsor_project(request, pk):
    project = get_object_or_404(Project, pk=pk, is_public=True)
    form = SponsorIntentForm(request.POST)
    if form.is_valid():
        SponsorIntent.objects.update_or_create(
            user=request.user,
            project=project,
            sponsor_type=form.cleaned_data["sponsor_type"],
            defaults={"note": form.cleaned_data.get("note", ""), "status": "pending"},
        )
        messages.success(request, "资助意向已记录，第一版不会产生在线支付。")
    else:
        messages.error(request, "资助意向提交失败，请检查表单。")
    return _project_redirect(project)

# Create your views here.
