import hashlib
import json
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.text import slugify

from .contracts import DEFAULT_THEME_FILE_SPACE
from .models import ImportLog, Project, ProjectDocument, ProjectStage, ProjectTag, Tag, Theme


STAGE_MAP = {
    "草稿": ProjectStage.DRAFT,
    "开放招募": ProjectStage.OPEN_RECRUITING,
    "组队中": ProjectStage.TEAM_BUILDING,
    "进行中": ProjectStage.ACTIVE,
    "实验中": ProjectStage.ACTIVE,
    "写作中": ProjectStage.ACTIVE,
    "投稿中": ProjectStage.ACTIVE,
    "已发表": ProjectStage.ARCHIVED,
    "暂停": ProjectStage.PAUSED,
    "归档": ProjectStage.ARCHIVED,
}


def import_topic_bundle(data, source_label="api-json", dry_run=False):
    projects = data.get("projects", [])
    themes = data.get("themes", [])
    total = len(projects)
    created = 0
    updated = 0
    failed = []

    if dry_run:
        for item in projects:
            normalize_project_item(item)
        return {"total_count": total, "created_count": 0, "updated_count": 0, "failed_count": 0, "failed": []}

    with transaction.atomic():
        sync_themes(themes)
        for item in projects:
            try:
                was_created = upsert_project(item, source_label=source_label, allow_create_theme=True)
                if was_created:
                    created += 1
                else:
                    updated += 1
            except Exception as exc:
                failed.append(f"{item.get('topic_id') or item.get('id')}: {exc}")

        ImportLog.objects.create(
            source_file=source_label,
            total_count=total,
            created_count=created,
            updated_count=updated,
            failed_count=len(failed),
            message="\n".join(failed[:200]),
        )

    return {
        "total_count": total,
        "created_count": created,
        "updated_count": updated,
        "failed_count": len(failed),
        "failed": failed,
    }


def sync_themes(themes):
    for order, item in enumerate(themes):
        name = item.get("name") or item.get("theme_dir")
        if not name:
            continue
        theme, _ = Theme.objects.get_or_create(name=name, defaults={"slug": unique_slug(Theme, name)})
        theme.slug = item.get("slug") or theme.slug
        theme.description = item.get("description", "")
        theme.cover_image = item.get("cover_image", "")
        theme.file_space = {**DEFAULT_THEME_FILE_SPACE, **(item.get("file_space") or {})}
        theme.sort_order = item.get("sort_order", order)
        theme.is_active = item.get("is_active", True)
        theme.save(update_fields=["slug", "description", "cover_image", "file_space", "sort_order", "is_active", "updated_at"])


def upsert_project(item, source_label="api-json", allow_create_theme=True):
    normalized = normalize_project_item(item, source_label, allow_create_theme=allow_create_theme)
    ensure_unique_theme_project_no(
        normalized["defaults"]["theme"],
        normalized["defaults"]["project_no"],
        topic_id=normalized["topic_id"],
    )
    project, created = Project.objects.update_or_create(topic_id=normalized["topic_id"], defaults=normalized["defaults"])
    sync_project_tags(project, normalized["tags"])
    sync_project_documents(project, normalized["documents"])
    return created


def create_project(item, source_label="api-admin", allow_create_theme=False):
    normalized = normalize_project_item(item, source_label, allow_create_theme=allow_create_theme)
    ensure_unique_theme_project_no(
        normalized["defaults"]["theme"],
        normalized["defaults"]["project_no"],
        topic_id=normalized["topic_id"],
    )
    project = Project.objects.create(topic_id=normalized["topic_id"], **normalized["defaults"])
    sync_project_tags(project, normalized["tags"])
    sync_project_documents(project, normalized["documents"])
    return project


def update_project(project, item, source_label="api-admin", allow_create_theme=False):
    normalized = normalize_project_item(item, source_label, allow_create_theme=allow_create_theme)
    ensure_unique_theme_project_no(
        normalized["defaults"]["theme"],
        normalized["defaults"]["project_no"],
        topic_id=normalized["topic_id"],
    )
    for field, value in normalized["defaults"].items():
        setattr(project, field, value)
    project.save(update_fields=[*normalized["defaults"].keys(), "updated_at"])
    sync_project_tags(project, normalized["tags"])
    sync_project_documents(project, normalized["documents"])
    return project


def normalize_project_item(item, source_label="api-json", allow_create_theme=True):
    topic_id = item.get("topic_id") or item.get("id")
    if not topic_id:
        raise ValueError("missing topic_id")
    title = item.get("title") or topic_id
    summary = item.get("summary", "")
    body_markdown = item.get("body_markdown") or item.get("markdown") or item.get("content") or ""
    content_hash = item.get("content_hash") or sha256(body_markdown or json.dumps(item, sort_keys=True, ensure_ascii=False))
    md_path = item.get("source_md_path") or item.get("md_path") or ""
    pdf_path = item.get("source_pdf_path") or item.get("pdf_path") or ""
    page_path = item.get("page_path") or ""
    llm_score = decimal_value(item.get("llm_score", item.get("total_score")))
    community_score = decimal_value(item.get("community_score"))
    composite_score = decimal_value(item.get("composite_score")) or llm_score
    documents = list(item.get("documents") or [])
    for doc_type, path in [("markdown", md_path), ("pdf", pdf_path), ("html", page_path)]:
        if path and not any(doc.get("doc_type") == doc_type and doc.get("path") == path for doc in documents):
            documents.append({"doc_type": doc_type, "title": title, "path": path, "content_hash": content_hash if doc_type == "markdown" else ""})

    return {
        "topic_id": topic_id,
        "defaults": {
            "title": title,
            "summary": summary,
            "problem_statement": item.get("problem_statement", ""),
            "research_goal": item.get("research_goal", ""),
            "technical_route": item.get("technical_route", ""),
            "data_requirements": item.get("data_requirements") or {},
            "evaluation_metrics": item.get("evaluation_metrics") or [],
            "expected_outputs": item.get("expected_outputs") or [],
            "compliance_notes": item.get("compliance_notes", ""),
            "body_markdown": body_markdown,
            "theme": theme_from_item(item, allow_create_theme=allow_create_theme),
            "project_no": item.get("project_no"),
            "stage": normalize_stage(item.get("stage")),
            "source_md_path": md_path,
            "source_pdf_path": pdf_path,
            "page_path": page_path,
            "content_hash": content_hash,
            "llm_score": llm_score,
            "community_score": community_score,
            "composite_score": composite_score,
            "recommended_journal": item.get("recommended_journal", ""),
            "needed_roles": item.get("needed_roles") or [],
            "score_dimensions": item.get("score_dimensions") or {},
            "source_payload": {"source": source_label, "payload": item},
            "has_pdf": bool(item.get("has_pdf") or pdf_path),
            "is_public": item.get("is_public", False),
            "imported_at": timestamp(item.get("updated_at")) or timezone.now(),
        },
        "tags": tag_names_from_item(item),
        "documents": documents,
    }


def theme_from_item(item, allow_create_theme=True):
    theme_value = item.get("theme") or item.get("theme_dir") or "未分类"
    if isinstance(theme_value, dict):
        name = theme_value.get("name") or theme_value.get("slug") or "未分类"
        slug = theme_value.get("slug")
        description = theme_value.get("description", "")
        file_space = theme_value.get("file_space") or {}
    else:
        name = str(theme_value)
        slug = None
        description = ""
        file_space = {}
    if not name.strip():
        raise ValueError("theme is required")
    theme = None
    if slug:
        theme = Theme.objects.filter(slug=slug).first()
    if theme is None:
        theme = Theme.objects.filter(Q(slug=name) | Q(name=name)).first()
    if theme is None and not allow_create_theme:
        raise ValueError("theme does not exist")
    if theme is None:
        theme, created = Theme.objects.get_or_create(name=name, defaults={"slug": slug or unique_slug(Theme, name), "is_active": True})
    else:
        created = False
    changed = False
    if created or not theme.file_space:
        theme.file_space = {**DEFAULT_THEME_FILE_SPACE, **file_space}
        changed = True
    if slug and theme.slug != slug:
        theme.slug = slug
        changed = True
    if description and theme.description != description:
        theme.description = description
        changed = True
    if changed:
        theme.save(update_fields=["slug", "description", "file_space", "updated_at"])
    return theme


def ensure_unique_theme_project_no(theme, project_no, topic_id):
    if theme is None or project_no in (None, ""):
        return
    conflict = Project.objects.filter(theme=theme, project_no=project_no).exclude(topic_id=topic_id).first()
    if conflict:
        raise ValueError(f"project_no {project_no} already exists in theme {theme.name}")


def tag_names_from_item(item):
    tag_names = []
    for key in ["tags", "display_tags", "method_tags", "task_tags", "evaluation_tags", "data_modality_tags", "clinical_tags", "governance_tags"]:
        for tag in item.get(key) or []:
            if tag and tag not in tag_names:
                tag_names.append(tag)
    return tag_names


def sync_project_tags(project, tag_names):
    keep_ids = []
    for name in tag_names:
        tag, _ = Tag.objects.get_or_create(name=name, defaults={"slug": unique_slug(Tag, name)})
        ProjectTag.objects.get_or_create(project=project, tag=tag)
        keep_ids.append(tag.id)
    ProjectTag.objects.filter(project=project).exclude(tag_id__in=keep_ids).delete()


def sync_project_documents(project, documents):
    keep_ids = []
    for item in documents:
        path = item.get("path")
        if not path:
            continue
        doc_type = normalize_document_type(item.get("doc_type"))
        document, _ = ProjectDocument.objects.update_or_create(
            project=project,
            doc_type=doc_type,
            path=path,
            defaults={"title": item.get("title") or project.title, "content_hash": item.get("content_hash", "")},
        )
        keep_ids.append(document.id)
    if keep_ids:
        ProjectDocument.objects.filter(project=project).exclude(id__in=keep_ids).delete()


def normalize_stage(stage):
    if not stage:
        return ProjectStage.DRAFT
    if stage in ProjectStage.values:
        return stage
    return STAGE_MAP.get(stage, ProjectStage.DRAFT)


def normalize_document_type(doc_type):
    values = ProjectDocument.DocumentType.values
    return doc_type if doc_type in values else ProjectDocument.DocumentType.OTHER


def timestamp(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if timezone.is_aware(value) else timezone.make_aware(value)
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.get_current_timezone())
    except (TypeError, ValueError, OSError):
        return None


def decimal_value(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        return None


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def unique_slug(model, text):
    base = slugify(text, allow_unicode=True) or "item"
    slug = base
    index = 2
    while model.objects.filter(slug=slug).exists():
        slug = f"{base}-{index}"
        index += 1
    return slug


def read_source_text(source, relative_path):
    if not relative_path:
        return ""
    source = Path(source)
    for base in [source.parent, source.parent.parent, Path.cwd()]:
        candidate = base / relative_path
        if candidate.exists() and candidate.is_file():
            return candidate.read_text(encoding="utf-8", errors="ignore")
    return ""
