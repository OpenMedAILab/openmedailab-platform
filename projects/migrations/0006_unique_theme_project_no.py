from django.db import migrations, models
from django.db.models import Count, Q


def clear_duplicate_theme_project_numbers(apps, schema_editor):
    Project = apps.get_model("projects", "Project")
    duplicate_groups = (
        Project.objects.exclude(theme_id__isnull=True)
        .exclude(project_no__isnull=True)
        .values("theme_id", "project_no")
        .annotate(row_count=Count("id"))
        .filter(row_count__gt=1)
    )
    for group in duplicate_groups:
        duplicates = list(
            Project.objects.filter(theme_id=group["theme_id"], project_no=group["project_no"]).order_by("id")
        )
        for project in duplicates[1:]:
            source_payload = project.source_payload or {}
            source_payload["deduplicated_project_no"] = project.project_no
            project.project_no = None
            project.source_payload = source_payload
            project.save(update_fields=["project_no", "source_payload"])


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0005_project_lifecycle_stage_cleanup"),
    ]

    operations = [
        migrations.RunPython(clear_duplicate_theme_project_numbers, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="project",
            constraint=models.UniqueConstraint(
                condition=Q(theme__isnull=False, project_no__isnull=False),
                fields=("theme", "project_no"),
                name="unique_project_theme_project_no",
            ),
        ),
    ]
