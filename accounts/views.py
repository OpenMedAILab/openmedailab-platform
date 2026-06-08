from django.shortcuts import redirect


def login_redirect(request):
    return redirect("/#/login")


def register(request):
    return redirect("/#/register")


def profile(request):
    return redirect("/#/dashboard")

# Create your views here.
