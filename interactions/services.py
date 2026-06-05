from decimal import Decimal

from django.db.models import Avg, Count

from projects.models import Project


def recalculate_project_community_score(project):
    aggregate = project.scores.aggregate(avg_score=Avg("score"), score_count=Count("id"))
    avg_score = aggregate["avg_score"]
    project.community_score = Decimal(str(round(avg_score, 2))) if avg_score is not None else None
    if project.llm_score is not None and project.community_score is not None:
        project.composite_score = Decimal(project.llm_score) * Decimal("0.7") + Decimal(project.community_score) * Decimal("0.3")
    elif project.llm_score is not None:
        project.composite_score = project.llm_score
    else:
        project.composite_score = project.community_score
    project.save(update_fields=["community_score", "composite_score", "updated_at"])
    return project


def project_stat_annotations(queryset=None):
    queryset = queryset or Project.objects.all()
    return queryset.annotate(
        follow_count=Count("follows", distinct=True),
        score_count=Count("scores", distinct=True),
        interest_count=Count("interests", distinct=True),
        sponsor_count=Count("sponsor_intents", distinct=True),
    )
