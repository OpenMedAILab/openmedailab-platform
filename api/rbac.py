ROLE_LABELS = {
    "guest": "访客",
    "doctor": "医生",
    "student": "学生",
    "teacher": "老师",
    "ai_engineer": "AI 工程师",
    "statistician": "医学统计",
    "sponsor": "资助者",
    "other": "注册用户",
    "admin": "管理员",
}


BASE_CAPABILITIES = {
    "browse_projects": True,
    "view_theme_space": True,
    "view_public_documents": True,
    "maintain_profile": False,
    "follow_project": False,
    "score_project": False,
    "express_interest": False,
    "claim_work": False,
    "sponsor_project": False,
    "view_dashboard": False,
    "medical_review": False,
    "technical_delivery": False,
    "statistical_design": False,
    "funding_support": False,
    "manage_themes": False,
    "manage_projects": False,
    "import_projects": False,
    "view_admin_console": False,
}


ROLE_CAPABILITY_PATCHES = {
    "doctor": {"medical_review": True},
    "teacher": {"medical_review": True},
    "ai_engineer": {"technical_delivery": True},
    "statistician": {"statistical_design": True},
    "sponsor": {"funding_support": True},
}


AUTHENTICATED_PATCH = {
    "maintain_profile": True,
    "follow_project": True,
    "score_project": True,
    "express_interest": True,
    "claim_work": True,
    "sponsor_project": True,
    "view_dashboard": True,
}


ADMIN_PATCH = {
    "maintain_profile": True,
    "follow_project": True,
    "score_project": True,
    "express_interest": True,
    "claim_work": True,
    "sponsor_project": True,
    "view_dashboard": True,
    "medical_review": True,
    "technical_delivery": True,
    "statistical_design": True,
    "funding_support": True,
    "manage_themes": True,
    "manage_projects": True,
    "import_projects": True,
    "view_admin_console": True,
}


def role_key(user):
    if not user or not user.is_authenticated:
        return "guest"
    if user.is_superuser or user.is_staff:
        return "admin"
    profile = getattr(user, "profile", None)
    return getattr(profile, "role_type", "other") or "other"


def capabilities_for_user(user):
    role = role_key(user)
    capabilities = dict(BASE_CAPABILITIES)
    if user and user.is_authenticated:
        capabilities.update(AUTHENTICATED_PATCH)
    capabilities.update(ROLE_CAPABILITY_PATCHES.get(role, {}))
    if role == "admin":
        capabilities.update(ADMIN_PATCH)
    return {
        "role": role,
        "role_label": ROLE_LABELS.get(role, "注册用户"),
        "capabilities": capabilities,
    }


def has_capability(user, capability):
    return bool(capabilities_for_user(user)["capabilities"].get(capability))
