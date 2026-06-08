from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction

from credits.models import CreditLedger


def create_registered_user(form):
    with transaction.atomic():
        user = form.save()
        CreditLedger.objects.create(
            user=user,
            action_type=CreditLedger.ActionType.REGISTER_BONUS,
            amount=user.profile.credit_balance,
            balance_after=user.profile.credit_balance,
            reason="注册初始积分",
        )
    return user


class DefaultPasswordConfigError(ValueError):
    pass


def get_system_default_password():
    default_password = getattr(settings, "OPENMEDAILAB_DEFAULT_PASSWORD", "")
    if not default_password:
        raise DefaultPasswordConfigError("系统默认密码未配置。")
    try:
        validate_password(default_password)
    except ValidationError as exc:
        raise DefaultPasswordConfigError("系统默认密码不符合密码强度要求。") from exc
    return default_password


def reset_user_to_default_password(user):
    default_password = get_system_default_password()
    with transaction.atomic():
        user.set_password(default_password)
        user.save(update_fields=["password"])
        profile = user.profile
        profile.must_change_password = True
        profile.save(update_fields=["must_change_password", "updated_at"])
    return default_password
