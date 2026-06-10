import re
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
VERSION_FILE = BASE_DIR / "VERSION"
CHANGELOG_FILE = BASE_DIR / "CHANGELOG.md"
SECTION_NAMES = {"Added", "Changed", "Fixed"}


def read_app_version():
    return VERSION_FILE.read_text(encoding="utf-8").strip()


APP_VERSION = read_app_version()


def release_payload():
    app_version = read_app_version()
    versions = parse_changelog()
    latest = versions[0] if versions else empty_release(app_version)
    return {
        "version": app_version,
        "latest": latest,
        "history": versions[1:],
    }


def parse_changelog():
    if not CHANGELOG_FILE.exists():
        return []
    lines = CHANGELOG_FILE.read_text(encoding="utf-8").splitlines()
    releases = []
    current = None
    current_section = None
    for line in lines:
        version_match = re.match(r"^##\s+(\d+\.\d+\.\d+)\s+-\s+(.+)$", line)
        if version_match:
            current = {
                "version": version_match.group(1),
                "date": version_match.group(2).strip(),
                "sections": {},
            }
            releases.append(current)
            current_section = None
            continue
        if current is None:
            continue
        section_match = re.match(r"^###\s+(.+)$", line)
        if section_match:
            section_name = section_match.group(1).strip()
            current_section = section_name if section_name in SECTION_NAMES else None
            if current_section:
                current["sections"].setdefault(current_section, [])
            continue
        item_match = re.match(r"^-\s+(.+)$", line)
        if item_match and current_section:
            current["sections"].setdefault(current_section, []).append(item_match.group(1).strip())
    return releases


def empty_release(version):
    return {
        "version": version,
        "date": "",
        "sections": {},
    }
