from accounts.models import is_platform_admin_user


ROLE_LABELS = {
    "guest": "访客",
    "doctor": "医生",
    "undergrad_or_below": "在读本科及以下",
    "master_student": "在读硕士",
    "phd_student": "在读博士",
    "phd_or_above": "博士毕业及以上",
    "engineer": "工程师",
    "student": "在读本科及以下",
    "teacher": "博士毕业及以上",
    "ai_engineer": "工程师",
    "statistician": "工程师",
    "sponsor": "注册用户",
    "other": "注册用户",
    "admin": "管理员",
}


BASE_CAPABILITIES = {
    "browse_projects": True,
    "view_theme_datasets": True,
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
    "manage_users": False,
    "view_admin_console": False,
    "review_interactions": False,
    "manage_tasks": False,
    "review_contributions": False,
    "manage_credits": False,
    "view_audit_logs": False,
}


ROLE_CAPABILITY_PATCHES = {
    "doctor": {"medical_review": True},
    "phd_or_above": {"medical_review": True},
    "engineer": {"technical_delivery": True},
    "teacher": {"medical_review": True},
    "ai_engineer": {"technical_delivery": True},
    "statistician": {"technical_delivery": True},
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
    "express_interest": False,
    "claim_work": False,
    "sponsor_project": False,
    "view_dashboard": True,
    "medical_review": True,
    "technical_delivery": True,
    "statistical_design": True,
    "funding_support": True,
    "manage_themes": True,
    "manage_projects": True,
    "manage_users": True,
    "view_admin_console": True,
    "review_interactions": True,
    "manage_tasks": True,
    "review_contributions": True,
    "manage_credits": True,
    "view_audit_logs": True,
}


def role_key(user):
    if not user or not user.is_authenticated:
        return "guest"
    if is_platform_admin_user(user):
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
