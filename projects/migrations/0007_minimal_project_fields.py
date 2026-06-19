from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0006_reset_project_identity"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="project",
            options={"ordering": ["topic_id"]},
        ),
        migrations.RemoveIndex(
            model_name="project",
            name="projects_pr_has_pdf_61be64_idx",
        ),
        migrations.RemoveIndex(
            model_name="project",
            name="projects_pr_composi_2220d7_idx",
        ),
        migrations.RemoveIndex(
            model_name="project",
            name="projects_pr_communi_b72979_idx",
        ),
        migrations.RemoveField(model_name="project", name="summary"),
        migrations.RemoveField(model_name="project", name="research_goal"),
        migrations.RemoveField(model_name="project", name="technical_route"),
        migrations.RemoveField(model_name="project", name="data_requirements"),
        migrations.RemoveField(model_name="project", name="evaluation_metrics"),
        migrations.RemoveField(model_name="project", name="expected_outputs"),
        migrations.RemoveField(model_name="project", name="compliance_notes"),
        migrations.RemoveField(model_name="project", name="body_markdown"),
        migrations.RemoveField(model_name="project", name="source_md_path"),
        migrations.RemoveField(model_name="project", name="source_pdf_path"),
        migrations.RemoveField(model_name="project", name="page_path"),
        migrations.RemoveField(model_name="project", name="content_hash"),
        migrations.RemoveField(model_name="project", name="llm_score"),
        migrations.RemoveField(model_name="project", name="community_score"),
        migrations.RemoveField(model_name="project", name="composite_score"),
        migrations.RemoveField(model_name="project", name="recommended_journal"),
        migrations.RemoveField(model_name="project", name="needed_roles"),
        migrations.RemoveField(model_name="project", name="score_dimensions"),
        migrations.RemoveField(model_name="project", name="has_pdf"),
    ]
