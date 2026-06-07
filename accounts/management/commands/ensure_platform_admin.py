from django.conf import settings
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import PLATFORM_ADMIN_UID, normalize_email


class Command(BaseCommand):
    help = "Create or update the single OpenMedAILab platform administrator."

    def add_arguments(self, parser):
        parser.add_argument("--username", default=getattr(settings, "OPENMEDAILAB_PLATFORM_ADMIN_USERNAME", "platform_admin"))
        parser.add_argument("--email", default=getattr(settings, "OPENMEDAILAB_PLATFORM_ADMIN_EMAIL", "admin@example.com"))
        parser.add_argument("--password", default=None)

    def handle(self, *args, **options):
        username = options["username"].strip()
        email = normalize_email(options["email"])
        password = options.get("password")
        if not username:
            raise CommandError("Platform admin username is required.")
        if not email:
            raise CommandError("Platform admin email is required.")

        admin_users = User.objects.filter(is_staff=True) | User.objects.filter(is_superuser=True)
        other_admins = admin_users.exclude(username=username).distinct()
        if other_admins.exists():
            names = ", ".join(other_admins.values_list("username", flat=True))
            raise CommandError(f"Multiple admin users found: {names}")

        with transaction.atomic():
            user, created = User.objects.get_or_create(username=username)
            user.email = email
            user.is_staff = True
            user.is_superuser = True
            if password:
                user.set_password(password)
            elif created:
                user.set_unusable_password()
            user.save()

            profile = user.profile
            profile.uid = PLATFORM_ADMIN_UID
            profile.display_name = profile.display_name or "平台管理员"
            profile.role_type = "other"
            profile.contact_email = email
            profile.email_normalized = email
            profile.save()

        action = "created" if created else "updated"
        self.stdout.write(self.style.SUCCESS(f"Platform admin {action}: {username} ({PLATFORM_ADMIN_UID})"))
