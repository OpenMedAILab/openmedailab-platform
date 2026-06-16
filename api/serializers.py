from decimal import Decimal

from .rbac import capabilities_for_user


def decimal_value(value):
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    return value


def user_payload(user):
    if not user or not user.is_authenticated:
        return None
    profile = getattr(user, "profile", None)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "is_staff": user.is_staff,
        "rbac": capabilities_for_user(user),
        "profile": profile_payload(profile) if profile else None,
    }


def uid_only_user_payload(user):
    if not user:
        return None
    profile = getattr(user, "profile", None)
    return {"uid": getattr(profile, "uid", None)}


def profile_payload(profile):
    return {
        "uid": profile.uid,
        "display_name": profile.display_name,
        "real_name": profile.real_name,
        "role_type": profile.role_type,
        "role_type_label": profile.get_role_type_display(),
        "organization": profile.organization,
        "title": profile.title,
        "research_interests": profile.research_interests,
        "skills": profile.skills,
        "available_hours_per_week": profile.available_hours_per_week,
        "contact_email": profile.contact_email,
        "must_change_password": profile.must_change_password,
        "contact_wechat": profile.contact_wechat,
        "bio": profile.bio,
        "credit_balance": profile.credit_balance,
        "reputation_score": profile.reputation_score,
        "created_at": profile.created_at,
        "updated_at": profile.updated_at,
    }


def theme_payload(theme):
    if theme is None:
        return None
    return {
        "id": theme.id,
        "name": theme.name,
        "slug": theme.slug,
        "description": theme.description,
        "cover_image": theme.cover_image,
        "sort_order": theme.sort_order,
        "is_active": theme.is_active,
    }


def tag_payload(tag):
    return {"id": tag.id, "name": tag.name, "slug": tag.slug}


def document_payload(document):
    return {
        "id": document.id,
        "doc_type": document.doc_type,
        "doc_type_label": document.get_doc_type_display(),
        "document_kind": document.document_kind,
        "document_kind_label": document.get_document_kind_display(),
        "title": document.title,
        "description": document.description,
        "path": document.path,
        "content_hash": document.content_hash,
        "created_at": document.created_at,
    }


def public_document_payload(document):
    return {
        "id": document.id,
        "doc_type": document.doc_type,
        "doc_type_label": document.get_doc_type_display(),
        "document_kind": document.document_kind,
        "document_kind_label": document.get_document_kind_display(),
        "title": document.title,
        "description": document.description,
        "path": public_document_path(document.path),
        "created_at": document.created_at,
    }


def theme_file_payload(file):
    return {
        "id": file.id,
        "theme_id": file.theme_id,
        "section": file.section,
        "file_type": file.file_type,
        "file_type_label": file.get_file_type_display(),
        "title": file.title,
        "description": file.description,
        "path": file.path,
        "detail_pdf_title": file.detail_pdf_title,
        "detail_pdf_path": public_document_path(file.detail_pdf_path),
        "sort_order": file.sort_order,
        "is_active": file.is_active,
        "created_at": file.created_at,
        "updated_at": file.updated_at,
    }


def project_detail_document_payload(project):
    documents = list(project.documents.all())
    for document in documents:
        if (
            document.document_kind == document.DocumentKind.DETAIL
            and document.doc_type == document.DocumentType.PDF
            and public_document_path(document.path)
        ):
            return public_document_payload(document)
    for document in documents:
        if document.doc_type == document.DocumentType.PDF and public_document_path(document.path):
            return public_document_payload(document)
    return None


def project_summary_payload(project):
    return {
        "id": project.id,
        "topic_id": project.topic_id,
        "topic_code": project.topic_code,
        "title": project.title,
        "title_en": project.title_en,
        "summary": project.summary,
        "problem_statement": project.problem_statement,
        "clinical_endpoint": project.clinical_endpoint,
        "existing_foundation": project.existing_foundation,
        "team_requirements": project.team_requirements,
        "project_progress": project.project_progress,
        "target_venue": project.target_venue,
        "theme": theme_payload(project.theme),
        "created_by": uid_only_user_payload(project.created_by) if getattr(project, "created_by_id", None) else None,
        "stage": project.stage,
        "stage_label": project.get_stage_display(),
        "tags": [tag_payload(tag) for tag in project.tags.all()],
        "is_public": project.is_public,
        "team_status": project.team_status,
        "follow_count": getattr(project, "follow_count", None),
        "score_count": getattr(project, "score_count", None),
        "interest_count": getattr(project, "interest_count", None),
        "sponsor_count": getattr(project, "sponsor_count", None),
        "detail_document": project_detail_document_payload(project),
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


def admin_project_summary_payload(project):
    payload = project_summary_payload(project)
    payload["imported_at"] = project.imported_at
    return payload


def project_detail_payload(project):
    payload = project_summary_payload(project)
    payload.update(
        {
            "team_status": project.team_status,
            "documents": [document_payload(document) for document in project.documents.all()],
            "source_payload": project.source_payload,
            "imported_at": project.imported_at,
        }
    )
    return payload


def public_project_detail_payload(project):
    payload = project_summary_payload(project)
    detail_document = project_detail_document_payload(project)
    documents = [detail_document] if detail_document else []
    payload.update(
        {
            "team_status": project.team_status,
            "detail_document": detail_document,
            "documents": documents,
        }
    )
    return payload


def public_document_path(path):
    value = str(path or "").strip()
    if not value:
        return ""
    parts = value.replace("\\", "/").split("/")
    if value.startswith("/media/"):
        if ".." in parts:
            return ""
        return value
    if value.startswith("/") or value.startswith("\\") or ".." in parts:
        return ""
    if ":" in value and not value.startswith(("http://", "https://")):
        return ""
    return value


def theme_dataset_payload(theme, projects, files):
    sections = {}
    for file in files:
        sections.setdefault(file.section, []).append(theme_file_payload(file))
    ordered_sections = []
    for section_name, section_files in sections.items():
        ordered_sections.append({"name": section_name, "files": section_files})
    return {
        "theme": theme_payload(theme),
        "project_count": len(projects),
        "file_count": len(files),
        "sections": ordered_sections,
        "projects": [project_summary_payload(project) for project in projects],
    }


def score_payload(score):
    return {
        "id": score.id,
        "project_id": score.project_id,
        "score": score.score,
        "comment": score.comment,
        "weight": decimal_value(score.weight),
        "created_at": score.created_at,
        "updated_at": score.updated_at,
    }


def interest_payload(interest):
    return {
        "id": interest.id,
        "project": project_summary_payload(interest.project),
        "role": interest.role,
        "role_label": interest.get_role_display(),
        "available_hours_per_week": interest.available_hours_per_week,
        "experience": interest.experience,
        "message": interest.message,
        "status": interest.status,
        "status_label": interest.get_status_display(),
        "created_at": interest.created_at,
        "updated_at": interest.updated_at,
    }


def claim_payload(claim):
    return {
        "id": claim.id,
        "project": project_summary_payload(claim.project),
        "claim_type": claim.claim_type,
        "claim_type_label": claim.get_claim_type_display(),
        "message": claim.message,
        "status": claim.status,
        "status_label": claim.get_status_display(),
        "created_at": claim.created_at,
        "updated_at": claim.updated_at,
    }


def sponsor_payload(sponsor):
    return {
        "id": sponsor.id,
        "project": project_summary_payload(sponsor.project),
        "sponsor_type": sponsor.sponsor_type,
        "sponsor_type_label": sponsor.get_sponsor_type_display(),
        "note": sponsor.note,
        "status": sponsor.status,
        "status_label": sponsor.get_status_display(),
        "created_at": sponsor.created_at,
        "updated_at": sponsor.updated_at,
    }


def follow_payload(follow):
    return {
        "id": follow.id,
        "project": project_summary_payload(follow.project),
        "created_at": follow.created_at,
    }


TASK_PROGRESS_BY_STATUS = {
    "todo": 0,
    "claimed": 25,
    "in_progress": 60,
    "review": 85,
    "done": 100,
    "cancelled": 0,
}


def task_progress_percent(task):
    return TASK_PROGRESS_BY_STATUS.get(task.status, 0)


def task_participant_uids(task):
    profile = getattr(getattr(task, "assignee", None), "profile", None)
    return [profile.uid] if profile and profile.uid else []


def task_payload(task):
    participant_uids = task_participant_uids(task)
    return {
        "id": task.id,
        "project": project_summary_payload(task.project),
        "title": task.title,
        "description": task.description,
        "task_type": task.task_type,
        "required_role": task.required_role,
        "difficulty": task.difficulty,
        "status": task.status,
        "status_label": task.get_status_display(),
        "assignee_uid": participant_uids[0] if participant_uids else None,
        "participant_uids": participant_uids,
        "progress_percent": task_progress_percent(task),
        "deadline": task.deadline,
        "credit_deposit": task.credit_deposit,
        "credit_reward": task.credit_reward,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


def contribution_payload(contribution):
    return {
        "id": contribution.id,
        "user": uid_only_user_payload(contribution.user),
        "project": project_summary_payload(contribution.project),
        "task": task_payload(contribution.task) if contribution.task else None,
        "title": contribution.title,
        "description": contribution.description,
        "file_path": contribution.file_path,
        "result_type": contribution.result_type,
        "result_type_label": contribution.get_result_type_display(),
        "status": contribution.status,
        "status_label": contribution.get_status_display(),
        "reviewer": uid_only_user_payload(contribution.reviewer) if contribution.reviewer else None,
        "review_comment": contribution.review_comment,
        "created_at": contribution.created_at,
        "reviewed_at": contribution.reviewed_at,
    }


def credit_ledger_payload(entry):
    return {
        "id": entry.id,
        "user": uid_only_user_payload(entry.user),
        "project": project_summary_payload(entry.project) if entry.project else None,
        "task": task_payload(entry.task) if entry.task else None,
        "action_type": entry.action_type,
        "action_type_label": entry.get_action_type_display(),
        "amount": entry.amount,
        "balance_after": entry.balance_after,
        "reason": entry.reason,
        "created_by": uid_only_user_payload(entry.created_by) if entry.created_by else None,
        "created_at": entry.created_at,
    }


def audit_log_payload(entry):
    return {
        "id": entry.id,
        "actor": uid_only_user_payload(entry.actor) if entry.actor else None,
        "action": entry.action,
        "action_label": audit_action_label(entry.action),
        "target_type": entry.target_type,
        "target_id": entry.target_id,
        "request_id": entry.request_id,
        "source": entry.source,
        "status": entry.status,
        "error_code": entry.error_code,
        "error_message": entry.error_message,
        "summary": audit_log_summary(entry),
        "before": entry.before,
        "after": entry.after,
        "created_at": entry.created_at,
    }


AUDIT_ACTION_LABELS = {
    "auth.register": "注册",
    "auth.login": "登录",
    "auth.logout": "退出登录",
    "auth.password_change_required": "强制修改密码",
    "profile.update": "更新个人资料",
    "interaction.review": "审核资助意向",
    "interaction.withdraw": "撤回协作意向",
    "project.stage_auto_team_building": "自动进入组队中",
    "project.follow": "收藏课题",
    "project.unfollow": "取消收藏",
    "project.score": "点赞课题",
    "project.unscore": "取消点赞",
    "project.user_create": "用户上传课题",
    "project.user_update": "用户更新课题",
    "project.user_archive": "用户归档课题",
    "interaction.auto_approve": "自动通过参与/认领",
    "interaction.submit_sponsor": "提交资助意向",
    "task.create": "创建任务",
    "task.update": "更新任务",
    "task.cancel": "取消任务",
    "task.assign": "分配任务",
    "task.status": "更新任务状态",
    "task.user_status": "用户更新任务",
    "task.submit_for_review": "任务提交审核",
    "contribution.submit": "提交任务结果",
    "contribution.review": "审核任务结果",
    "user.reset_password": "恢复默认密码",
    "theme.create": "创建主题",
    "theme.update": "更新主题",
    "theme.deactivate": "停用主题",
    "theme_file.create": "创建主题文件",
    "theme_file.update": "更新主题文件",
    "theme_file.deactivate": "停用主题文件",
    "project.create": "创建课题",
    "project.update": "更新课题",
    "project.upsert": "更新课题",
    "project.archive": "归档课题",
    "project.import_json": "导入课题",
}


def audit_action_label(action):
    return AUDIT_ACTION_LABELS.get(action, action)


def audit_log_summary(entry):
    data = entry.after or entry.before or {}
    if not isinstance(data, dict):
        return audit_action_label(entry.action)

    if entry.action.startswith("auth.") or entry.action.startswith("profile."):
        if entry.status == "failed":
            return compact_join(
                [
                    data.get("uid"),
                    data.get("username"),
                    entry.error_message,
                ]
            ) or audit_action_label(entry.action)
        return compact_join(
            [
                data.get("uid"),
                data.get("role_label"),
            ]
        ) or audit_action_label(entry.action)

    note = first_present(data, "review_note", "reason", "note")
    if entry.action.startswith("interaction."):
        user_uid = user_uid_from_payload(data)
        project = data.get("project") or {}
        project_label = project.get("topic_id") or project.get("title")
        parts = [
            data.get("type_label") or audit_action_label(entry.action),
            data.get("subtype_label") or data.get("subtype"),
            data.get("status_label"),
            user_uid,
            project_label,
            note,
        ]
        return compact_join(parts) or audit_action_label(entry.action)

    if note:
        return str(note)

    project = data.get("project") if isinstance(data.get("project"), dict) else {}
    parts = [
        data.get("title") or data.get("name") or project.get("title") or project.get("topic_id"),
        data.get("status_label") or data.get("stage_label"),
        data.get("uid") or user_uid_from_payload(data),
    ]
    summary = compact_join(parts)
    if summary:
        return summary
    return f"{audit_action_label(entry.action)} · {entry.target_type} #{entry.target_id}".strip()


def first_present(data, *keys):
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None


def nested_value(data, *keys):
    value = data
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def user_uid_from_payload(data):
    return nested_value(data, "user", "uid") or nested_value(data, "user", "profile", "uid")


def compact_join(parts):
    return " · ".join(str(part) for part in parts if part not in (None, ""))


def admin_user_detail_payload(user, follows, interests, claims, sponsors, scores, tasks, contributions, credits):
    return {
        "user": user_payload(user),
        "follows": [follow_payload(item) for item in follows],
        "interests": [interest_payload(item) for item in interests],
        "claims": [claim_payload(item) for item in claims],
        "sponsors": [sponsor_payload(item) for item in sponsors],
        "scores": [
            {
                **score_payload(item),
                "project": project_summary_payload(item.project),
            }
            for item in scores
        ],
        "tasks": [task_payload(item) for item in tasks],
        "contributions": [contribution_payload(item) for item in contributions],
        "credits": [credit_ledger_payload(item) for item in credits],
    }


def dashboard_payload(user, follows, interests, claims, sponsors, scores, tasks=None, contributions=None, credits=None):
    return {
        "user": user_payload(user),
        "follows": [follow_payload(item) for item in follows],
        "interests": [interest_payload(item) for item in interests],
        "claims": [claim_payload(item) for item in claims],
        "sponsors": [sponsor_payload(item) for item in sponsors],
        "scores": [
            {
                **score_payload(item),
                "project": project_summary_payload(item.project),
            }
            for item in scores
        ],
        "tasks": [task_payload(item) for item in (tasks or [])],
        "contributions": [contribution_payload(item) for item in (contributions or [])],
        "credits": [credit_ledger_payload(item) for item in (credits or [])],
    }
