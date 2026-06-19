#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

.venv/bin/python manage.py check
.venv/bin/python manage.py makemigrations --check --dry-run
.venv/bin/python manage.py test accounts api projects interactions credits

cd frontend
node --check src/main.js
node --test src/*.test.js
npm run build
npm run test:e2e

cd ..
git diff --check
python scripts/check_release_version.py
