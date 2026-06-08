from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client, TestCase


class PlatformAdminCommandTests(TestCase):
    def test_ensure_platform_admin_creates_unique_admin(self):
        call_command(
            "ensure_platform_admin",
            username="platform_admin",
            email="admin@example.com",
            password="StrongPass12345",
        )

        admin = User.objects.get(username="platform_admin")
        self.assertTrue(admin.is_staff)
        self.assertTrue(admin.is_superuser)
        self.assertEqual(admin.email, "admin@example.com")
        self.assertEqual(admin.profile.uid, "ADM00000001")
        self.assertEqual(User.objects.filter(is_staff=True).count(), 1)
        self.assertEqual(User.objects.filter(is_superuser=True).count(), 1)

    def test_ensure_platform_admin_updates_existing_admin(self):
        call_command(
            "ensure_platform_admin",
            username="platform_admin",
            email="old@example.com",
            password="StrongPass12345",
        )
        call_command(
            "ensure_platform_admin",
            username="platform_admin",
            email="new@example.com",
            password="StrongPass12345",
        )

        self.assertEqual(User.objects.filter(username="platform_admin").count(), 1)
        admin = User.objects.get(username="platform_admin")
        self.assertEqual(admin.email, "new@example.com")
        self.assertEqual(admin.profile.uid, "ADM00000001")

    def test_ensure_platform_admin_fails_when_another_admin_exists(self):
        User.objects.create_user(
            username="other_admin",
            email="other@example.com",
            password="StrongPass12345",
            is_staff=True,
            is_superuser=True,
        )

        with self.assertRaises(CommandError):
            call_command(
                "ensure_platform_admin",
                username="platform_admin",
                email="admin@example.com",
                password="StrongPass12345",
            )


class LegacyAccountRouteTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_legacy_account_pages_redirect_to_vue_routes(self):
        login_response = self.client.get("/accounts/login/")
        register_response = self.client.get("/accounts/register/")
        profile_response = self.client.get("/accounts/profile/")

        self.assertEqual(login_response.status_code, 302)
        self.assertEqual(login_response["Location"], "/#/login")
        self.assertEqual(register_response.status_code, 302)
        self.assertEqual(register_response["Location"], "/#/register")
        self.assertEqual(profile_response.status_code, 302)
        self.assertEqual(profile_response["Location"], "/#/dashboard")
