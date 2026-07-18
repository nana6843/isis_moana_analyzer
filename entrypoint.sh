#!/bin/sh
set -e

echo "=== Collecting static files ==="
python manage.py collectstatic --noinput --settings=main_project.settings_production

echo "=== Running migrations ==="
python manage.py migrate --settings=main_project.settings_production

echo "=== Starting Gunicorn ==="
exec gunicorn main_project.wsgi:application \
    --env DJANGO_SETTINGS_MODULE=main_project.settings_production \
    --bind 0.0.0.0:8000 \
    --workers 3 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -