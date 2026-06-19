from django.db.models import Count, Q

from interactions.models import InteractionStatus
from projects.models import Project


def recalculate_project_community_score(project):
    project.save(update_fields=["updated_at"])
    return project


def project_stat_annotations(queryset=None):
    if queryset is None:
        queryset = Project.objects.all()
    return queryset.annotate(
        follow_count=Count("follows", distinct=True),
        score_count=Count("scores", distinct=True),
        interest_count=Count("interests", distinct=True),
        sponsor_count=Count(
            "sponsor_intents",
            filter=Q(sponsor_intents__status=InteractionStatus.APPROVED),
            distinct=True,
        ),
    )
