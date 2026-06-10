from django.db import migrations, models


def recorded_to_approved(apps, schema_editor):
    for model_name in ["ProjectInterest", "ProjectClaimIntent", "SponsorIntent"]:
        model = apps.get_model("interactions", model_name)
        model.objects.filter(status="recorded").update(status="approved")


def noop_reverse(apps, schema_editor):
    pass


INTERACTION_STATUS_CHOICES = [
    ("pending", "待处理"),
    ("approved", "已通过"),
    ("rejected", "已拒绝"),
    ("withdrawn", "已撤回"),
]


class Migration(migrations.Migration):

    dependencies = [
        ("interactions", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(recorded_to_approved, noop_reverse),
        migrations.AlterField(
            model_name="projectclaimintent",
            name="status",
            field=models.CharField(choices=INTERACTION_STATUS_CHOICES, default="pending", max_length=32),
        ),
        migrations.AlterField(
            model_name="projectinterest",
            name="status",
            field=models.CharField(choices=INTERACTION_STATUS_CHOICES, default="pending", max_length=32),
        ),
        migrations.AlterField(
            model_name="sponsorintent",
            name="status",
            field=models.CharField(choices=INTERACTION_STATUS_CHOICES, default="pending", max_length=32),
        ),
    ]
