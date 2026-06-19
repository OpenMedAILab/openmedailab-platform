from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0012_auditlog_error_code_auditlog_error_message_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="projectdocument",
            name="document_kind",
            field=models.CharField(
                choices=[("detail", "课题主PDF"), ("supplement", "补充说明")],
                default="supplement",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="themefile",
            name="detail_pdf_hash",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="themefile",
            name="detail_pdf_path",
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name="themefile",
            name="detail_pdf_title",
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
