#!/usr/bin/env python3
"""Write one uploadable project JSON next to each topic PDF."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_UPLOAD_ROOT = ROOT.parent / "upload"
DEFAULT_PROJECTS = DEFAULT_UPLOAD_ROOT / "generated-openmedailab-projects.json"
DEFAULT_DOCUMENTS = DEFAULT_UPLOAD_ROOT / "generated-openmedailab-project-documents.json"

PROJECT_FIELDS = [
    "id",
    "theme",
    "title",
    "title_en",
    "summary",
    "problem_statement",
    "clinical_endpoint",
    "existing_foundation",
    "tags",
    "target_venue",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Split aggregate project JSON into per-topic JSON files next to PDFs.")
    parser.add_argument("--projects", type=Path, default=DEFAULT_PROJECTS, help="Aggregate project JSON path.")
    parser.add_argument("--documents", type=Path, default=DEFAULT_DOCUMENTS, help="Document manifest path containing pdf_path.")
    parser.add_argument("--dry-run", action="store_true", help="Report planned files without writing.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    projects = load_projects(args.projects)
    documents = load_documents(args.documents)
    project_by_id = {str(project.get("id") or project.get("topic_id")): project for project in projects}
    written = 0
    missing = []

    for document in documents:
        project_id = str(document.get("id") or document.get("topic_id") or "")
        project = project_by_id.get(project_id)
        pdf_path = Path(document.get("pdf_path") or "").expanduser()
        if not project or not pdf_path:
            missing.append(project_id or "<missing id>")
            continue
        json_path = pdf_path.with_suffix(".json")
        payload = {field: project.get(field, [] if field == "tags" else "") for field in PROJECT_FIELDS}
        if not args.dry_run:
            json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written += 1

    print(f"per-topic json files: {written}")
    print(f"missing project/doc rows: {len(missing)}")
    if missing:
        print("first missing:", ", ".join(missing[:20]))
    return 1 if missing else 0


def load_projects(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("projects"), list):
        return data["projects"]
    raise ValueError("Project JSON must be an array or {'projects': [...]}.")


def load_documents(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("documents"), list):
        return data["documents"]
    raise ValueError("Document manifest must be an array or {'documents': [...]}.")


if __name__ == "__main__":
    raise SystemExit(main())
