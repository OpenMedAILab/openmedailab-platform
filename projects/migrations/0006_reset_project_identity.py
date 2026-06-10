from django.db import migrations, models


def clear_project_rows(apps, schema_editor):
    Project = apps.get_model("projects", "Project")
    Project.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0005_project_lifecycle_stage_cleanup"),
    ]

    operations = [
        migrations.RunPython(clear_project_rows, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="project",
            name="project_no",
        ),
        migrations.AddField(
            model_name="project",
            name="clinical_endpoint",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="project",
            name="existing_foundation",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="project",
            name="title_en",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AlterField(
            model_name="project",
            name="topic_id",
            field=models.PositiveIntegerField(unique=True),
        ),
    ]
