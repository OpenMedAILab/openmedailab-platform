import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def main():
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    package = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")

    errors = []
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        errors.append("VERSION must use MAJOR.MINOR.PATCH format.")
    if package.get("version") != version:
        errors.append(f"frontend/package.json version {package.get('version')} does not match VERSION {version}.")
    latest_release = re.search(r"^##\s+(\d+\.\d+\.\d+)\s+-\s+", changelog, flags=re.MULTILINE)
    if not latest_release or latest_release.group(1) != version:
        errors.append(f"CHANGELOG.md top release must include version {version}.")

    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print(f"release version ok: {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
