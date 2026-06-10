from django.db import migrations, models


def map_legacy_project_stages(apps, schema_editor):
    Project = apps.get_model("projects", "Project")
    Project.objects.filter(stage__in=["experimenting", "writing", "submitted"]).update(stage="active")
    Project.objects.filter(stage="published").update(stage="archived", is_public=False)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0004_project_lifecycle_defaults"),
    ]

    operations = [
        migrations.RunPython(map_legacy_project_stages, noop_reverse),
        migrations.AlterField(
            model_name="project",
            name="stage",
            field=models.CharField(
                choices=[
                    ("draft", "草稿"),
                    ("open_recruiting", "开放招募"),
                    ("team_building", "组队中"),
                    ("active", "进行中"),
                    ("paused", "暂停"),
                    ("archived", "归档"),
                ],
                default="draft",
                max_length=32,
            ),
        ),
    ]
