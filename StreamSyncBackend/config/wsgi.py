"""
WSGI entrypoint, used by gunicorn for the HTTP-only deployment.

Once Django Channels arrives in Milestone 7 the ASGI entrypoint becomes the
primary one, since WebSockets cannot be served over WSGI.
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.production")

application = get_wsgi_application()
