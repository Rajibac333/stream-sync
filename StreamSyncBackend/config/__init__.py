"""
Ensures the Celery app is loaded when Django starts.

`@shared_task` resolves against whichever Celery app is current, so importing
it here — before any app module runs — is what makes tasks defined across the
project register against this one.
"""

from .celery import app as celery_app

__all__ = ["celery_app"]
