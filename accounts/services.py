import secrets

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


def generate_default_password(username):
    random_number = secrets.randbelow(900000) + 100000
    return f"{username}{random_number}"


def reset_user_to_default_password(user):
    default_password = generate_default_password(user.username)
    with transaction.atomic():
        user.set_password(default_password)
        user.save(update_fields=["password"])
        profile = user.profile
        profile.must_change_password = True
        profile.save(update_fields=["must_change_password", "updated_at"])
    return default_password
