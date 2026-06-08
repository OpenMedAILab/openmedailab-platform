from django.conf import settings
from django.http import HttpResponse, JsonResponse


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
            response["Access-Control-Allow-Headers"] = "Content-Type, X-CSRFToken"
            response["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            response["Vary"] = "Origin"
        return response


class PasswordChangeRequiredMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if self.must_block_request(request):
            return JsonResponse(
                {
                    "ok": False,
                    "error": {
                        "code": "password_change_required",
                        "message": "使用默认密码登录后，必须先修改密码并重新登录。",
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
