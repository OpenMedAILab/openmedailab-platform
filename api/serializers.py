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


def profile_payload(profile):
    return {
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
        "file_space": theme.file_space,
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
        "title": document.title,
        "path": document.path,
        "content_hash": document.content_hash,
        "created_at": document.created_at,
    }


def project_summary_payload(project):
    return {
        "id": project.id,
        "topic_id": project.topic_id,
        "title": project.title,
        "summary": project.summary,
        "problem_statement": project.problem_statement,
        "research_goal": project.research_goal,
        "technical_route": project.technical_route,
        "data_requirements": project.data_requirements,
        "evaluation_metrics": project.evaluation_metrics,
        "expected_outputs": project.expected_outputs,
        "compliance_notes": project.compliance_notes,
        "theme": theme_payload(project.theme),
        "project_no": project.project_no,
        "stage": project.stage,
        "stage_label": project.get_stage_display(),
        "tags": [tag_payload(tag) for tag in project.tags.all()],
        "llm_score": decimal_value(project.llm_score),
        "community_score": decimal_value(project.community_score),
        "composite_score": decimal_value(project.composite_score),
        "recommended_journal": project.recommended_journal,
        "needed_roles": project.needed_roles,
        "has_pdf": project.has_pdf,
        "is_public": project.is_public,
        "follow_count": getattr(project, "follow_count", None),
        "score_count": getattr(project, "score_count", None),
        "interest_count": getattr(project, "interest_count", None),
        "sponsor_count": getattr(project, "sponsor_count", None),
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


def project_detail_payload(project):
    payload = project_summary_payload(project)
    payload.update(
        {
            "body_markdown": project.body_markdown,
            "source_md_path": project.source_md_path,
            "source_pdf_path": project.source_pdf_path,
            "page_path": project.page_path,
            "content_hash": project.content_hash,
            "score_dimensions": project.score_dimensions,
            "team_status": project.team_status,
            "documents": [document_payload(document) for document in project.documents.all()],
            "source_payload": project.source_payload,
            "imported_at": project.imported_at,
        }
    )
    return payload


def theme_space_payload(theme, projects, documents):
    grouped_documents = {}
    for document in documents:
        grouped_documents.setdefault(document.doc_type, []).append(document_payload(document))
    return {
        "theme": theme_payload(theme),
        "project_count": len(projects),
        "document_count": len(documents),
        "documents_by_type": grouped_documents,
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


def dashboard_payload(user, follows, interests, claims, sponsors, scores):
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
    }
