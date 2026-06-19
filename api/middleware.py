from contextvars import ContextVar
from datetime import timedelta
from uuid import uuid4

from django.conf import settings
from django.db import OperationalError
from django.http import HttpResponse, JsonResponse
from django.utils import timezone

from accounts.models import UserProfile


CURRENT_REQUEST_ID = ContextVar("openmedailab_request_id", default="")
REQUEST_ID_MAX_LENGTH = 64


def current_request_id():
    return CURRENT_REQUEST_ID.get()


def normalize_request_id(value):
    request_id = str(value or "").strip()
    if not request_id:
        return uuid4().hex
    return request_id[:REQUEST_ID_MAX_LENGTH]


class RequestIDMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = normalize_request_id(request.headers.get("X-Request-ID"))
        request.openmedailab_request_id = request_id
        token = CURRENT_REQUEST_ID.set(request_id)
        try:
            response = self.get_response(request)
        finally:
            CURRENT_REQUEST_ID.reset(token)
        response["X-Request-ID"] = request_id
        return response


PASSWORD_CHANGE_ALLOWED_API_PATHS = {
    "/api/health/",
    "/api/csrf/",
    "/api/meta/",
    "/api/rbac/",
    "/api/project-schema/",
    "/api/me/",
    "/api/auth/logout/",
    "/api/auth/password/change-required/",
}


class SimpleCorsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == "OPTIONS" and request.path.startswith("/api/"):
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)

        origin = request.headers.get("Origin")
        allowed_origins = getattr(settings, "OPENMEDAILAB_CORS_ALLOWED_ORIGINS", [])
        if origin and origin in allowed_origins:
            response["Access-Control-Allow-Origin"] = origin
            response["Access-Control-Allow-Credentials"] = "true"
            response["Access-Control-Allow-Headers"] = "Content-Type, X-CSRFToken, X-Request-ID"
            response["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            response["Vary"] = "Origin"
        return response


class LastSeenMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        self.touch_authenticated_user(request)
        return self.get_response(request)

    def touch_authenticated_user(self, request):
        if request.method == "OPTIONS":
            return
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return
        try:
            profile = user.profile
        except UserProfile.DoesNotExist:
            return
        now = timezone.now()
        interval_seconds = getattr(settings, "OPENMEDAILAB_LAST_SEEN_UPDATE_INTERVAL_SECONDS", 60)
        if profile.last_seen_at and profile.last_seen_at >= now - timedelta(seconds=interval_seconds):
            return
        try:
            UserProfile.objects.filter(pk=profile.pk).update(last_seen_at=now)
        except OperationalError as exc:
            message = str(exc).lower()
            if "database is locked" not in message and "database table is locked" not in message:
                raise
            return
        profile.last_seen_at = now


class PasswordChangeRequiredMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if self.must_block_request(request):
            request_id = getattr(request, "openmedailab_request_id", current_request_id())
            return JsonResponse(
                {
                    "ok": False,
                    "request_id": request_id,
                    "error": {
                        "code": "password_change_required",
                        "message": "使用默认密码登录后，必须先修改密码并重新登录。",
                        "request_id": request_id,
                    },
                },
                status=403,
            )
        return self.get_response(request)

    def must_block_request(self, request):
        if request.method == "OPTIONS" or not request.path.startswith("/api/"):
            return False
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        profile = getattr(user, "profile", None)
        if not getattr(profile, "must_change_password", False):
            return False
        return request.path not in PASSWORD_CHANGE_ALLOWED_API_PATHS
