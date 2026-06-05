# OpenMedAILab Backend MVP

This repository is the Django backend MVP for OpenMedAILab. It implements the part owned by 钱护磊: database models, topic import, authentication, user interactions, admin management, basic statistics, and deployment-ready settings.

## Scope

- Django project and app structure.
- `accounts`, `projects`, `interactions`, and `credits` apps.
- User profile creation after registration.
- Topic, theme, tag, document, task, contribution, credit ledger, import log, and audit log models.
- Follow, score, participation interest, claim intent, and sponsor intent persistence.
- Django Admin registration for core models.
- Repeatable `topics_index.json` import command.
- Basic templates for backend route verification and frontend handoff.

## Local Development

Use conda Python in this workspace.

```bash
conda run -n base python -m pip install -r requirements.txt
cp .env.example .env
conda run -n base python manage.py migrate
conda run -n base python manage.py import_topics --source OpenMedAILab_old/site/topics_index.json
conda run -n base python manage.py runserver 127.0.0.1:8000
```

Open:

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/projects/`
- `http://127.0.0.1:8000/admin/`

## Production Notes

Environment variables are loaded from `.env`.

```text
DEBUG=0
SECRET_KEY=<strong-secret>
ALLOWED_HOSTS=your-domain.com,server-ip
DATABASE_URL=sqlite:////opt/openmedailab/db.sqlite3
STATIC_ROOT=/opt/openmedailab/staticfiles
MEDIA_ROOT=/opt/openmedailab/media
```

Deployment command shape:

```bash
conda run -n base python manage.py migrate
conda run -n base python manage.py import_topics --source /path/to/topics_index.json
conda run -n base python manage.py collectstatic --noinput
conda run -n base gunicorn config.wsgi:application --bind 127.0.0.1:8000
```
