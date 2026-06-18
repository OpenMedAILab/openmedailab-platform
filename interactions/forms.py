from django import forms

from .models import AuthorshipIntent, ClaimType, ParticipationRole, ProjectClaimIntent, ProjectInterest, ProjectScore, SponsorIntent, SponsorType


class ProjectScoreForm(forms.ModelForm):
    class Meta:
        model = ProjectScore
        fields = ("score", "comment")
        widgets = {
            "score": forms.NumberInput(attrs={"min": 1, "max": 10}),
            "comment": forms.Textarea(attrs={"rows": 3}),
        }


class ProjectInterestForm(forms.ModelForm):
    role = forms.ChoiceField(choices=ParticipationRole.choices)
    authorship_intention = forms.ChoiceField(choices=AuthorshipIntent.choices)

    class Meta:
        model = ProjectInterest
        fields = ("role", "available_hours_per_week", "experience", "message", "authorship_intention")
        widgets = {
            "experience": forms.Textarea(attrs={"rows": 3}),
            "message": forms.Textarea(attrs={"rows": 3}),
        }


class ProjectClaimIntentForm(forms.ModelForm):
    claim_type = forms.ChoiceField(choices=ClaimType.choices)
    claimed_unit_name = forms.CharField(required=False, max_length=100)

    class Meta:
        model = ProjectClaimIntent
        fields = ("claim_type", "message", "claimed_unit_name")
        widgets = {"message": forms.Textarea(attrs={"rows": 3})}


class SponsorIntentForm(forms.ModelForm):
    sponsor_type = forms.ChoiceField(choices=SponsorType.choices)

    class Meta:
        model = SponsorIntent
        fields = ("sponsor_type", "note")
        widgets = {"note": forms.Textarea(attrs={"rows": 3})}
