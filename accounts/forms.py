from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User
from django.db import transaction

from .models import RoleType, UserProfile, normalize_email, uid_for_user


class RegisterForm(UserCreationForm):
    email = forms.EmailField(required=True)
    display_name = forms.CharField(max_length=80, required=False, label="昵称")
    role_type = forms.ChoiceField(choices=RoleType.choices, label="主要身份")

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("username", "email", "display_name", "role_type", "password1", "password2")

    def clean_email(self):
        email = normalize_email(self.cleaned_data.get("email", ""))
        if not email:
            raise forms.ValidationError("邮箱不能为空。", code="required")
        if (
            User.objects.filter(email__iexact=email).exists()
            or UserProfile.objects.filter(email_normalized=email).exists()
            or UserProfile.objects.filter(contact_email__iexact=email).exists()
        ):
            raise forms.ValidationError("该邮箱已经注册。", code="unique")
        return email

    def save(self, commit=True):
        user = super().save(commit=False)
        user.email = self.cleaned_data.get("email", "")
        if commit:
            user._openmedailab_initial_role_type = self.cleaned_data["role_type"]
            user._openmedailab_display_name = self.cleaned_data.get("display_name") or user.username
            user.save()
            profile = user.profile
            profile.display_name = self.cleaned_data.get("display_name") or user.username
            profile.role_type = self.cleaned_data["role_type"]
            if not profile.uid:
                profile.uid = uid_for_user(user, profile.role_type)
            profile.contact_email = user.email
            profile.email_normalized = normalize_email(user.email)
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

    def clean_contact_email(self):
        email = normalize_email(self.cleaned_data.get("contact_email", ""))
        if not email:
            return ""
        profile_qs = UserProfile.objects.exclude(pk=self.instance.pk)
        user_qs = User.objects.exclude(pk=self.instance.user_id)
        if (
            user_qs.filter(email__iexact=email).exists()
            or profile_qs.filter(email_normalized=email).exists()
            or profile_qs.filter(contact_email__iexact=email).exists()
        ):
            raise forms.ValidationError("该邮箱已经注册。", code="unique")
        return email

    def save(self, commit=True):
        profile = super().save(commit=False)
        email = normalize_email(self.cleaned_data.get("contact_email", ""))
        profile.contact_email = email
        profile.email_normalized = email or None
        if commit:
            with transaction.atomic():
                profile.user.email = email
                profile.user.save(update_fields=["email"])
                profile.save()
        return profile
