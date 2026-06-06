import json

from django.core.serializers.json import DjangoJSONEncoder
from django.http import JsonResponse


def ok(data=None, status=200, **extra):
    payload = {"ok": True}
    if data is not None:
        payload["data"] = data
    payload.update(extra)
    return JsonResponse(payload, status=status, encoder=DjangoJSONEncoder)


def fail(message, status=400, code="bad_request", errors=None):
    payload = {"ok": False, "error": {"code": code, "message": message}}
    if errors is not None:
        payload["error"]["details"] = errors
    return JsonResponse(payload, status=status, encoder=DjangoJSONEncoder)


def parse_json(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc.msg}") from exc


def form_errors(form):
    return form.errors.get_json_data()
