import hashlib
import json
import re
import shutil
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from projects.importing import normalize_topic_id, upsert_project_with_instance
from projects.models import Project, ProjectDocument, ProjectStage


class Command(BaseCommand):
    help = "Import project JSON and bind matching PDFs from source directories or a document manifest."

    def add_arguments(self, parser):
        parser.add_argument(
            "--source",
            action="append",
            default=[],
            help="Directory or JSON file to auto-discover per-topic project JSON. Directories scan only *.json and matching same-stem *.pdf. Can be repeated.",
        )
        parser.add_argument("--projects", help="Path to aggregate project JSON, usually generated-openmedailab-projects.json")
        parser.add_argument("--documents", help="Path to document manifest JSON, usually generated-openmedailab-project-documents.json")
        parser.add_argument("--publish", action="store_true", help="Import projects as public open-recruiting projects.")
        parser.add_argument("--preserve-ids", action="store_true", help="Use id/topic_id values from JSON instead of auto-numbering from the current database max.")
        parser.add_argument("--dry-run", action="store_true", help="Validate and report without writing database rows or copying files.")

    def handle(self, *args, **options):
        projects_path = Path(options["projects"]).expanduser().resolve() if options.get("projects") else None
        documents_path = Path(options["documents"]).expanduser().resolve() if options.get("documents") else None
        publish = options["publish"]
        preserve_ids = options["preserve_ids"]
        dry_run = options["dry_run"]

        if not projects_path and not options["source"]:
            raise ValueError("Pass --source or --projects.")
        if projects_path and not projects_path.exists():
            raise FileNotFoundError(f"Project JSON does not exist: {projects_path}")
        if documents_path and not documents_path.exists():
            raise FileNotFoundError(f"Document manifest does not exist: {documents_path}")

        project_entries = []
        auto_document_items = []
        if projects_path:
            project_entries.extend(load_project_entries(projects_path))
        for source_value in options["source"]:
            source_entries = discover_project_entries(Path(source_value).expanduser().resolve())
            project_entries.extend(source_entries)
            auto_document_items.extend(auto_document_items_for_entries(source_entries))
        if not project_entries:
            raise ValueError("No project JSON records found.")

        document_items = load_document_items(documents_path) if documents_path else []
        document_items = dedupe_document_items([*document_items, *auto_document_items])

        with transaction.atomic():
            imported = import_projects(project_entries, publish=publish, preserve_ids=preserve_ids)
            document_items = remap_document_items(document_items, imported)
            document_result = bind_documents(document_items, dry_run=dry_run)
            if dry_run:
                transaction.set_rollback(True)

        self.stdout.write(
            self.style.SUCCESS(
                "Projects: total={total} created={created} updated={updated}. "
                "Documents: total={doc_total} bound={doc_bound} missing={doc_missing} skipped={doc_skipped}.".format(
                    total=len(project_entries),
                    created=imported["created"],
                    updated=imported["updated"],
                    doc_total=len(document_items),
                    doc_bound=document_result["bound"],
                    doc_missing=document_result["missing"],
                    doc_skipped=document_result["skipped"],
                )
            )
        )
        if document_result["errors"]:
            for error in document_result["errors"][:20]:
                self.stdout.write(self.style.WARNING(error))
            raise SystemExit(1)


def discover_project_entries(source):
    if not source.exists():
        raise FileNotFoundError(f"Source does not exist: {source}")
    if source.is_file():
        return load_project_entries(source)
    if not source.is_dir():
        raise ValueError(f"Source must be a directory or JSON file: {source}")
    entries = []
    for path in sorted(source.glob("*.json")):
        entries.extend(load_project_entries(path, allow_skip=True))
    return entries


def load_project_entries(path, allow_skip=False):
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict) and isinstance(data.get("projects"), list):
        items = data["projects"]
    elif isinstance(data, dict) and isinstance(data.get("project"), dict):
        items = [data["project"]]
    elif isinstance(data, dict):
        items = [data]
    else:
        items = []
    entries = [{"payload": item, "json_path": path} for item in items if is_project_item(item)]
    if not entries and not allow_skip:
        raise ValueError("Project JSON must contain project object(s).")
    return entries


def is_project_item(item):
    return isinstance(item, dict) and bool(item.get("title")) and bool(item.get("theme"))


def load_document_items(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("documents"), list):
        return data["documents"]
    raise ValueError("Document manifest must be an array or {'documents': [...]}.")


def auto_document_items_for_entries(entries):
    document_items = []
    for entry in entries:
        project = entry["payload"]
        json_path = entry["json_path"]
        pdf_path = json_path.with_suffix(".pdf")
        if not pdf_path.exists():
            continue
        document_items.append(
            {
                "id": project.get("id") or project.get("topic_id"),
                "_json_path": str(json_path),
                "pdf_path": str(pdf_path),
                "doc_type": "pdf",
                "document_title": "项目详细说明",
                "description": "完整课题方案 PDF",
            }
        )
    return document_items


def dedupe_document_items(items):
    deduped = []
    seen = set()
    for item in items:
        key = (
            str(item.get("_json_path") or item.get("id") or item.get("topic_id") or ""),
            str(item.get("pdf_path") or item.get("path") or ""),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def import_projects(entries, publish=False, preserve_ids=False):
    created = 0
    updated = 0
    project_ids_by_json_path = {}
    project_ids_by_source_id = {}
    for entry in entries:
        data = dict(entry["payload"])
        source_id = source_topic_id(data)
        if not preserve_ids:
            data.pop("id", None)
            data.pop("topic_id", None)
        if publish:
            data["stage"] = ProjectStage.OPEN_RECRUITING
            data["is_public"] = True
        project, was_created = upsert_project_with_instance(data, source_label=str(entry["json_path"]), allow_create_theme=True)
        project_ids_by_json_path[str(entry["json_path"])] = project.topic_id
        if source_id:
            project_ids_by_source_id[source_id] = project.topic_id
        if was_created:
            created += 1
        else:
            updated += 1
    return {
        "created": created,
        "updated": updated,
        "project_ids_by_json_path": project_ids_by_json_path,
        "project_ids_by_source_id": project_ids_by_source_id,
    }


def source_topic_id(data):
    try:
        topic_id = normalize_topic_id(data.get("topic_id") or data.get("id"))
    except ValueError:
        return ""
    return str(topic_id) if topic_id else ""


def remap_document_items(items, imported):
    remapped = []
    by_json_path = imported.get("project_ids_by_json_path", {})
    by_source_id = imported.get("project_ids_by_source_id", {})
    for item in items:
        data = dict(item)
        assigned_id = None
        if data.get("_json_path"):
            assigned_id = by_json_path.get(str(data["_json_path"]))
        source_id = source_topic_id(data)
        if assigned_id is None and source_id:
            assigned_id = by_source_id.get(source_id)
        if assigned_id is not None:
            data["id"] = assigned_id
            data.pop("topic_id", None)
        remapped.append(data)
    return remapped


def bind_documents(items, dry_run=False):
    result = {"bound": 0, "missing": 0, "skipped": 0, "errors": []}
    for index, item in enumerate(items, start=1):
        try:
            status = bind_document(item, dry_run=dry_run)
            result[status] += 1
        except Exception as exc:
            result["errors"].append(f"row {index}: {exc}")
    return result


def bind_document(item, dry_run=False):
    topic_id = normalize_topic_id(item.get("topic_id") or item.get("id"))
    if not topic_id:
        raise ValueError("document row is missing id/topic_id")
    project = Project.objects.filter(topic_id=topic_id).first()
    if not project:
        raise ValueError(f"project T{topic_id:04d} does not exist")

    raw_source_path = str(item.get("pdf_path") or item.get("path") or "").strip()
    if not raw_source_path:
        return "missing"
    source_path = Path(raw_source_path).expanduser().resolve()
    if not source_path.exists() or not source_path.is_file():
        return "missing"

    doc_type = normalize_document_type(item.get("doc_type") or source_path.suffix.lstrip("."))
    title = str(item.get("document_title") or item.get("title") or source_path.stem).strip()[:255]
    description = str(item.get("description") or title or "课题文档").strip()

    destination = document_destination(project, source_path)
    content_hash = hash_file(source_path)
    if not dry_run:
        destination = copy_document_if_needed(source_path, destination, content_hash)
        public_path = public_media_path(destination)
        ProjectDocument.objects.update_or_create(
            project=project,
            doc_type=doc_type,
            path=public_path,
            defaults={"title": title, "description": description, "content_hash": content_hash},
        )
    return "bound"


def normalize_document_type(value):
    text = str(value or "").strip().lower()
    if text in ProjectDocument.DocumentType.values:
        return text
    if text == "pdf":
        return ProjectDocument.DocumentType.PDF
    if text in {"md", "markdown"}:
        return ProjectDocument.DocumentType.MARKDOWN
    if text in {"html", "htm"}:
        return ProjectDocument.DocumentType.HTML
    return ProjectDocument.DocumentType.OTHER


def document_root():
    return (Path(settings.MEDIA_ROOT) / "project-documents").expanduser().resolve()


def document_destination(project, source_path):
    root = document_root()
    directory = (root / project.topic_code).resolve()
    if directory != root and root not in directory.parents:
        raise ValueError("document directory is outside MEDIA_ROOT")
    filename = sanitize_file_name(source_path.name)
    if not filename:
        raise ValueError("document file name is invalid")
    return (directory / filename).resolve()


def sanitize_file_name(value):
    name = str(value or "").replace("\\", "/").split("/")[-1].strip()
    if name in {"", ".", ".."} or "\x00" in name:
        return ""
    return re.sub(r"[\\/]+", "_", name)


def copy_document_if_needed(source_path, destination, source_hash):
    destination.parent.mkdir(parents=True, exist_ok=True)
    root = document_root()
    candidate = destination
    suffix = destination.suffix
    stem = destination.stem or "document"
    index = 2
    while candidate.exists() and hash_file(candidate) != source_hash:
        candidate = (destination.parent / f"{stem}-{index}{suffix}").resolve()
        if candidate.parent != root and root not in candidate.parent.parents:
            raise ValueError("document destination is outside MEDIA_ROOT")
        index += 1
    if not candidate.exists():
        shutil.copy2(source_path, candidate)
    return candidate


def hash_file(path):
    hasher = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def public_media_path(path):
    media_root = Path(settings.MEDIA_ROOT).expanduser().resolve()
    relative = Path(path).resolve().relative_to(media_root).as_posix()
    return f"{settings.MEDIA_URL.rstrip('/')}/{relative}"
