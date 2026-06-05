from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User

from .models import RoleType, UserProfile


class RegisterForm(UserCreationForm):
    email = forms.EmailField(required=False)
    display_name = forms.CharField(max_length=80, required=False, label="昵称")
    role_type = forms.ChoiceField(choices=RoleType.choices, label="主要身份")

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("username", "email", "display_name", "role_type", "password1", "password2")

    def save(self, commit=True):
        user = super().save(commit=commit)
        user.email = self.cleaned_data.get("email", "")
        if commit:
            user.save()
            profile = user.profile
            profile.display_name = self.cleaned_data.get("display_name") or user.username
            profile.role_type = self.cleaned_data["role_type"]
            profile.contact_email = user.email
            profile.save()
        return user


class UserProfileForm(forms.ModelForm):
    class Meta:
        model = UserProfile
        fields = (
            "display_name",
            "real_name",
            "role_type",
            "organization",
            "title",
            "research_interests",
            "skills",
            "available_hours_per_week",
            "contact_email",
            "contact_wechat",
            "bio",
        )
