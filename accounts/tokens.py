import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone

from .models import AccountToken


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_account_token(user, purpose, ttl_minutes=60):
    raw_token = secrets.token_urlsafe(32)
    token = AccountToken.objects.create(
        user=user,
        purpose=purpose,
        token_hash=hash_token(raw_token),
        expires_at=timezone.now() + timedelta(minutes=ttl_minutes),
    )
    return raw_token, token


def get_active_token(raw_token, purpose, user=None):
    query = AccountToken.objects.filter(
        token_hash=hash_token(raw_token),
        purpose=purpose,
        used_at__isnull=True,
        expires_at__gt=timezone.now(),
    )
    if user is not None:
        query = query.filter(user=user)
    return query.select_related("user").order_by("-created_at").first()
