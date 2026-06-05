from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render

from credits.models import CreditLedger

from .forms import RegisterForm, UserProfileForm


def register(request):
    if request.method == "POST":
        form = RegisterForm(request.POST)
        if form.is_valid():
            user = form.save()
            CreditLedger.objects.create(
                user=user,
                action_type=CreditLedger.ActionType.REGISTER_BONUS,
                amount=user.profile.credit_balance,
                balance_after=user.profile.credit_balance,
                reason="注册初始积分",
            )
            login(request, user)
            messages.success(request, "注册成功，已进入你的工作台。")
            return redirect("dashboard")
    else:
        form = RegisterForm()
    return render(request, "accounts/register.html", {"form": form})


@login_required
def profile(request):
    if request.method == "POST":
        form = UserProfileForm(request.POST, instance=request.user.profile)
        if form.is_valid():
            form.save()
            messages.success(request, "个人资料已更新。")
            return redirect("profile")
    else:
        form = UserProfileForm(instance=request.user.profile)
    return render(request, "accounts/profile.html", {"form": form})

# Create your views here.
