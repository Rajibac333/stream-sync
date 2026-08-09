"""
The Celery application.

Background work exists so an HTTP request never waits on something the user did
not ask for. Assigning a task should return as soon as the task is saved; the
notification that follows is the system's problem, not the caller's.
(README §22)

Started with:

    celery -A config worker --loglevel=info
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

app = Celery("streamsync")

# Settings live in Django's config under a CELERY_ prefix, so there is one
# place to configure the system rather than two.
app.config_from_object("django.conf:settings", namespace="CELERY")

# Finds tasks.py in every installed app.
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self) -> str:
    """Proves a worker is connected and consuming. Used by the readiness docs."""
    return f"request: {self.request!r}"
