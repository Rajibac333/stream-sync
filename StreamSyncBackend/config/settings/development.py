"""
Local development settings.

Optimised for fast feedback and readable errors. Nothing here is safe to run
on a public host — `production.py` is the deployable configuration.
"""

from .base import *
from .base import REST_FRAMEWORK, env

DEBUG = env.bool("DJANGO_DEBUG", default=True)

# A development-only fallback. Production refuses to boot without a real key,
# so this constant can never leak into a deployed environment.
SECRET_KEY = env(
    "DJANGO_SECRET_KEY",
    default="django-insecure-development-only-do-not-use-in-production",
)

ALLOWED_HOSTS = env.list(
    "DJANGO_ALLOWED_HOSTS",
    default=["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "backend"],
)

# The Vite dev server, over both loopback spellings.
#
# 5173 is `npm run dev` and 4173 is `npm run preview`. 5273 and 5274 are the
# ports the frontend's Playwright configs pin for the mock and live end-to-end
# runs (StreamSyncFrontend/playwright*.config.ts) — a browser refused by CORS
# reports a bare network error, so an unlisted port looks to the tester like a
# backend that is down rather than one that is running and saying no.
CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:5273",
        "http://localhost:5274",
    ],
)

CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=CORS_ALLOWED_ORIGINS)

# The browsable API is a genuine development aid for hand-testing endpoints.
# Production stays JSON-only.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
}

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# ---------------------------------------------------------------------------
# Running without Redis
#
# `docker compose up` provides Redis and needs none of this. It exists for the
# laptop case: a developer running `manage.py runserver` directly, with no
# broker installed, who still wants to open the editor.
#
# Set DJANGO_USE_REDIS=False to substitute in-process backends.
#
# THE LIMITATION IS REAL. Both substitutes are per-process, so presence and
# broadcasts only reach sockets served by the *same* worker. `runserver` is one
# process, so two browser tabs still see each other — but this configuration
# proves nothing about whether real-time works across workers, which is the
# only thing that matters in production. Never set this outside development.
# ---------------------------------------------------------------------------

if not env.bool("DJANGO_USE_REDIS", default=True):
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "streamsync-development",
        },
    }
    CHANNEL_LAYERS = {
        "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"},
    }
    # No broker either, so tasks run inline in the web process. Notifications
    # still appear; nothing is actually backgrounded. Without this, every
    # `.delay()` would try to reach a Redis that is not there.
    CELERY_TASK_ALWAYS_EAGER = True
    CELERY_TASK_EAGER_PROPAGATES = False
    CELERY_BROKER_URL = "memory://"
    CELERY_RESULT_BACKEND = None
