import re

from django.db import IntegrityError, transaction
from django.db.models import Max, Q
from django.utils import timezone
from django.utils.text import slugify

from .contracts import DEFAULT_THEME_FILE_SPACE
from .models import ImportLog, Project, ProjectStage, ProjectTag, Tag, Theme


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


def upsert_project(item, source_label="api-json", allow_create_theme=True, created_by=None):
    normalized = normalize_project_item(item, source_label, allow_create_theme=allow_create_theme)
    if normalized["topic_id"]:
        project, created = Project.objects.update_or_create(topic_id=normalized["topic_id"], defaults=normalized["defaults"])
    else:
        project = create_project_with_auto_topic_id(normalized["defaults"])
        created = True
    if created_by and (created or project.created_by_id is None):
        project.created_by = created_by
        project.save(update_fields=["created_by", "updated_at"])
    sync_project_tags(project, normalized["tags"])
    return created


def upsert_project_with_instance(item, source_label="api-json", allow_create_theme=True, created_by=None):
    normalized = normalize_project_item(item, source_label, allow_create_theme=allow_create_theme)
    if normalized["topic_id"]:
        project, created = Project.objects.update_or_create(topic_id=normalized["topic_id"], defaults=normalized["defaults"])
    else:
        project = create_project_with_auto_topic_id(normalized["defaults"])
        created = True
    if created_by and (created or project.created_by_id is None):
        project.created_by = created_by
        project.save(update_fields=["created_by", "updated_at"])
    sync_project_tags(project, normalized["tags"])
    return project, created


def create_project(item, source_label="api-admin", allow_create_theme=False, created_by=None):
    normalized = normalize_project_item(item, source_label, allow_create_theme=allow_create_theme)
    if created_by:
        normalized["defaults"]["created_by"] = created_by
    if normalized["topic_id"]:
        project = Project.objects.create(topic_id=normalized["topic_id"], **normalized["defaults"])
    else:
        project = create_project_with_auto_topic_id(normalized["defaults"])
    sync_project_tags(project, normalized["tags"])
    return project


def update_project(project, item, source_label="api-admin", allow_create_theme=False):
    normalized = normalize_project_item(item, source_label, allow_create_theme=allow_create_theme)
    for field, value in normalized["defaults"].items():
        setattr(project, field, value)
    project.save(update_fields=[*normalized["defaults"].keys(), "updated_at"])
    sync_project_tags(project, normalized["tags"])
    return project


def normalize_project_item(item, source_label="api-json", allow_create_theme=True):
    topic_id = normalize_topic_id(item.get("topic_id") or item.get("id"))
    title = item.get("title") or (str(topic_id) if topic_id else "")
    if not title:
        raise ValueError("title is required")
    return {
        "topic_id": topic_id,
        "defaults": {
            "title": title,
            "title_en": item.get("title_en", item.get("title_en_us", "")),
            "summary": item.get("summary", ""),
            "problem_statement": item.get("problem_statement", ""),
            "clinical_endpoint": item.get("clinical_endpoint", ""),
            "existing_foundation": item.get("existing_foundation", ""),
            "team_requirements": item.get("team_requirements", ""),
            "project_progress": item.get("project_progress", ""),
            "target_venue": item.get("target_venue", ""),
            "theme": theme_from_item(item, allow_create_theme=allow_create_theme),
            "stage": normalize_stage(item.get("stage")),
            "source_payload": {"source": source_label, "payload": item},
            "is_public": item.get("is_public", False),
            "imported_at": timezone.now(),
        },
        "tags": tag_names_from_item(item),
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


def normalize_stage(stage):
    if not stage:
        return ProjectStage.DRAFT
    if stage in ProjectStage.values:
        return stage
    return STAGE_MAP.get(stage, ProjectStage.DRAFT)


def normalize_topic_id(value):
    if value in (None, ""):
        return None
    text = str(value).strip()
    code_match = re.fullmatch(r"[Tt](\d{4})", text)
    if code_match:
        text = code_match.group(1)
    if not text.isdigit():
        raise ValueError("topic_id must be between 1 and 9999 or use T0001 format")
    number = int(text)
    if number <= 0 or number > 9999:
        raise ValueError("topic_id must be between 1 and 9999 or use T0001 format")
    return number


def next_topic_id():
    number = (Project.objects.aggregate(max_topic_id=Max("topic_id"))["max_topic_id"] or 0) + 1
    if number > 9999:
        raise ValueError("topic_id exceeds T9999")
    return number


def create_project_with_auto_topic_id(defaults, max_attempts=5):
    for attempt in range(max_attempts):
        topic_id = next_topic_id()
        try:
            with transaction.atomic():
                return Project.objects.create(topic_id=topic_id, **defaults)
        except IntegrityError as exc:
            message = str(exc).lower()
            if "topic_id" not in message and "unique" not in message:
                raise
            if attempt == max_attempts - 1:
                raise ValueError("topic_id auto-number collision, please retry.") from exc
    raise ValueError("topic_id auto-number collision, please retry.")


def unique_slug(model, text):
    base = slugify(text, allow_unicode=True) or "item"
    slug = base
    index = 2
    while model.objects.filter(slug=slug).exists():
        slug = f"{base}-{index}"
        index += 1
    return slug
