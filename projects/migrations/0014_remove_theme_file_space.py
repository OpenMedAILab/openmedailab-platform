from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0013_projectdocument_kind_themefile_detail_pdf"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="theme",
            name="file_space",
        ),
    ]
