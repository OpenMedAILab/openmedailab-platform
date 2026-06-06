from django import forms

from .models import ClaimType, ParticipationRole, ProjectClaimIntent, ProjectInterest, ProjectScore, SponsorIntent, SponsorType


def _role_choices():
    labels = {"Leader": "项目负责人", "AI工程师": "AI 工程师"}
    return [(value, labels.get(value, label)) for value, label in ParticipationRole.choices]


class CleanLabelFormMixin:
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.label_suffix = ""


class ProjectScoreForm(CleanLabelFormMixin, forms.ModelForm):
    class Meta:
        model = ProjectScore
        fields = ("score", "comment")
        labels = {
            "score": "评分",
            "comment": "判断依据",
        }
        help_texts = {
            "score": "请输入 1-10 分。",
            "comment": "可选，补充一句推荐或保留意见。",
        }
        widgets = {
            "score": forms.NumberInput(attrs={"min": 1, "max": 10}),
            "comment": forms.Textarea(attrs={"rows": 3}),
        }


class ProjectInterestForm(CleanLabelFormMixin, forms.ModelForm):
    role = forms.ChoiceField(choices=_role_choices(), label="参与角色")

    class Meta:
        model = ProjectInterest
        fields = ("role", "available_hours_per_week", "experience", "message")
        labels = {
            "available_hours_per_week": "每周可投入时间",
            "experience": "相关经验",
            "message": "补充说明",
        }
        help_texts = {
            "available_hours_per_week": "填写预计每周小时数。",
            "experience": "可选，说明临床、算法、数据或写作经验。",
            "message": "可选，补充你希望团队了解的信息。",
        }
        widgets = {
            "experience": forms.Textarea(attrs={"rows": 3}),
            "message": forms.Textarea(attrs={"rows": 3}),
        }


class ProjectClaimIntentForm(CleanLabelFormMixin, forms.ModelForm):
    claim_type = forms.ChoiceField(choices=ClaimType.choices, label="认领方向")

    class Meta:
        model = ProjectClaimIntent
        fields = ("claim_type", "message")
        labels = {
            "message": "推动计划",
        }
        help_texts = {
            "message": "可选，说明你准备如何推动这个方向。",
        }
        widgets = {"message": forms.Textarea(attrs={"rows": 3})}


class SponsorIntentForm(CleanLabelFormMixin, forms.ModelForm):
    sponsor_type = forms.ChoiceField(choices=SponsorType.choices, label="支持类型")

    class Meta:
        model = SponsorIntent
        fields = ("sponsor_type", "note")
        labels = {
            "note": "支持说明",
        }
        help_texts = {
            "note": "可选，说明预算、算力、数据或专家资源范围。",
        }
        widgets = {"note": forms.Textarea(attrs={"rows": 3})}
