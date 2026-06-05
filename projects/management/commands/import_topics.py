import hashlib
import json
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from projects.models import ImportLog, Project, ProjectDocument, ProjectStage, ProjectTag, Tag, Theme


STAGE_MAP = {
    "草稿": ProjectStage.DRAFT,
    "开放招募": ProjectStage.OPEN_RECRUITING,
    "组队中": ProjectStage.TEAM_BUILDING,
    "进行中": ProjectStage.ACTIVE,
    "实验中": ProjectStage.EXPERIMENTING,
    "写作中": ProjectStage.WRITING,
    "投稿中": ProjectStage.SUBMITTED,
    "已发表": ProjectStage.PUBLISHED,
    "暂停": ProjectStage.PAUSED,
    "归档": ProjectStage.ARCHIVED,
}


class Command(BaseCommand):
    help = "Import OpenMedAILab topics from topics_index.json."

    def add_arguments(self, parser):
        parser.add_argument("--source", required=True, help="Path to topics_index.json")
        parser.add_argument("--dry-run", action="store_true", help="Validate input without writing database rows")

    def handle(self, *args, **options):
        source = Path(options["source"]).expanduser().resolve()
        if not source.exists():
            raise FileNotFoundError(f"Source file does not exist: {source}")

        with source.open("r", encoding="utf-8") as f:
            data = json.load(f)

        projects = data.get("projects", [])
        total = len(projects)
        created = 0
        updated = 0
        failed = []

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"Validated {total} project records from {source}"))
            return

        with transaction.atomic():
            self._sync_themes(data.get("themes", []))
            for item in projects:
                try:
                    was_created = self._upsert_project(source, item)
                    if was_created:
                        created += 1
                    else:
                        updated += 1
                except Exception as exc:
                    failed.append(f"{item.get('topic_id') or item.get('id')}: {exc}")

            ImportLog.objects.create(
                source_file=str(source),
                total_count=total,
                created_count=created,
                updated_count=updated,
                failed_count=len(failed),
                message="\n".join(failed[:200]),
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Imported {total} projects: created={created}, updated={updated}, failed={len(failed)}"
            )
        )
        if failed:
            self.stdout.write(self.style.WARNING("\n".join(failed[:20])))

    def _sync_themes(self, themes):
        for order, item in enumerate(themes):
            name = item.get("name") or item.get("theme_dir")
            if not name:
                continue
            theme, created = Theme.objects.get_or_create(name=name, defaults={"slug": self._unique_slug(Theme, name)})
            theme.description = item.get("description", "")
            theme.sort_order = order
            theme.is_active = True
            theme.save(update_fields=["description", "sort_order", "is_active", "updated_at"])

    def _upsert_project(self, source, item):
        topic_id = item.get("topic_id") or item.get("id")
        if not topic_id:
            raise ValueError("missing topic_id")

        theme = self._get_theme(item)
        md_path = item.get("md_path") or ""
        pdf_path = item.get("pdf_path") or ""
        page_path = item.get("page_path") or ""
        body_markdown = self._read_source_text(source, md_path)
        content_hash = self._sha256(body_markdown or json.dumps(item, sort_keys=True, ensure_ascii=False))
        llm_score = self._decimal(item.get("total_score"))
        composite_score = llm_score
        stage = self._normalize_stage(item.get("stage"))
        imported_at = self._timestamp(item.get("updated_at")) or timezone.now()

        defaults = {
            "title": item.get("title", topic_id),
            "summary": item.get("summary", ""),
            "body_markdown": body_markdown,
            "theme": theme,
            "project_no": item.get("project_no"),
            "stage": stage,
            "source_md_path": md_path,
            "source_pdf_path": pdf_path,
            "page_path": page_path,
            "content_hash": content_hash,
            "llm_score": llm_score,
            "composite_score": composite_score,
            "recommended_journal": item.get("recommended_journal", ""),
            "needed_roles": item.get("needed_roles") or [],
            "score_dimensions": item.get("score_dimensions") or {},
            "has_pdf": bool(item.get("has_pdf")),
            "is_public": True,
            "imported_at": imported_at,
        }

        project, created = Project.objects.update_or_create(topic_id=topic_id, defaults=defaults)
        self._sync_tags(project, item)
        self._sync_documents(project, md_path, pdf_path, page_path, content_hash)
        return created

    def _get_theme(self, item):
        name = item.get("theme") or item.get("theme_dir") or "未分类"
        theme, _ = Theme.objects.get_or_create(
            name=name,
            defaults={"slug": self._unique_slug(Theme, name), "is_active": True},
        )
        return theme

    def _sync_tags(self, project, item):
        tag_names = []
        for key in ["tags", "display_tags", "method_tags", "task_tags", "evaluation_tags", "data_modality_tags", "clinical_tags", "governance_tags"]:
            for tag in item.get(key) or []:
                if tag and tag not in tag_names:
                    tag_names.append(tag)

        keep_ids = []
        for name in tag_names:
            tag, _ = Tag.objects.get_or_create(name=name, defaults={"slug": self._unique_slug(Tag, name)})
            ProjectTag.objects.get_or_create(project=project, tag=tag)
            keep_ids.append(tag.id)
        ProjectTag.objects.filter(project=project).exclude(tag_id__in=keep_ids).delete()

    def _sync_documents(self, project, md_path, pdf_path, page_path, content_hash):
        specs = [
            (ProjectDocument.DocumentType.MARKDOWN, md_path, content_hash),
            (ProjectDocument.DocumentType.PDF, pdf_path, ""),
            (ProjectDocument.DocumentType.HTML, page_path, ""),
        ]
        for doc_type, path, doc_hash in specs:
            if not path:
                continue
            ProjectDocument.objects.update_or_create(
                project=project,
                doc_type=doc_type,
                path=path,
                defaults={"title": project.title, "content_hash": doc_hash},
            )

    def _read_source_text(self, source, relative_path):
        if not relative_path:
            return ""
        for base in [source.parent, source.parent.parent, Path.cwd()]:
            candidate = base / relative_path
            if candidate.exists() and candidate.is_file():
                return candidate.read_text(encoding="utf-8", errors="ignore")
        return ""

    def _normalize_stage(self, stage):
        if not stage:
            return ProjectStage.OPEN_RECRUITING
        if stage in ProjectStage.values:
            return stage
        return STAGE_MAP.get(stage, ProjectStage.OPEN_RECRUITING)

    def _timestamp(self, value):
        if not value:
            return None
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.get_current_timezone())
        except (TypeError, ValueError, OSError):
            return None

    def _decimal(self, value):
        if value in (None, ""):
            return None
        try:
            return Decimal(str(value)).quantize(Decimal("0.01"))
        except (InvalidOperation, TypeError, ValueError):
            return None

    def _sha256(self, text):
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def _unique_slug(self, model, text):
        base = slugify(text, allow_unicode=True) or "item"
        slug = base
        index = 2
        while model.objects.filter(slug=slug).exists():
            slug = f"{base}-{index}"
            index += 1
        return slug
