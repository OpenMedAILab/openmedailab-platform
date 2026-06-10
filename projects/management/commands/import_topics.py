import json
from pathlib import Path

from django.core.management.base import BaseCommand

from projects.importing import import_topic_bundle


class Command(BaseCommand):
    help = "Import OpenMedAILab topics from topics_index.json."

    def add_arguments(self, parser):
        parser.add_argument("--source", required=True, help="Path to topics_index.json")
        parser.add_argument("--dry-run", action="store_true", help="Validate input without writing database rows")

    def handle(self, *args, **options):
        source = Path(options["source"]).expanduser().resolve()
        if not source.exists():
            raise FileNotFoundError(f"Source file does not exist: {source}")

        data = json.loads(source.read_text(encoding="utf-8"))
        result = import_topic_bundle(data, source_label=str(source), dry_run=options["dry_run"])
        self.stdout.write(
            self.style.SUCCESS(
                "Imported {total_count} projects: created={created_count}, updated={updated_count}, failed={failed_count}".format(
                    **result
                )
            )
        )
        if result["failed"]:
            self.stdout.write(self.style.WARNING("\n".join(result["failed"][:20])))
