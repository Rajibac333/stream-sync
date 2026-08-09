"""
Test settings.

Built on development so the suite exercises the same middleware, permission
defaults and error handling developers see locally, with only the adjustments
that make tests fast and deterministic.
"""

from .base import *
from .base import MIDDLEWARE, REST_FRAMEWORK, env

DEBUG = False

SECRET_KEY = "django-insecure-test-only-key"

ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]

CORS_ALLOWED_ORIGINS = ["http://localhost:5173"]

# WhiteNoise serves the output of `collectstatic`, a build artefact that does
# not exist in a source checkout. Nothing under test serves static files, so
# the middleware is dropped rather than having every test depend on a build
# step. Everything else in MIDDLEWARE is kept, so request id handling, CORS
# and CSRF are exercised exactly as they are in production.
MIDDLEWARE = [m for m in MIDDLEWARE if "whitenoise" not in m]

# PBKDF2 with full work factor dominates the runtime of any test that creates a
# user. MD5 is unsafe in every other context and appears nowhere else.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# Throttling shares process state across tests and makes assertions depend on
# execution order, so the global throttles are off. The scoped rates stay
# defined — a ScopedRateThrottle declared on a view raises ImproperlyConfigured
# when its scope has no rate — but are set high enough never to trip
# accidentally. tests/accounts/test_auth_throttling.py lowers them deliberately.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {
        "auth_login": "1000/min",
        "auth_register": "1000/min",
        "auth_refresh": "1000/min",
        "workspace_invite": "1000/min",
        "ai_burst": "1000/min",
        "ai": "1000/min",
    },
}

# ---------------------------------------------------------------------------
# AI
#
# The deterministic provider, always. Milestone 9 requires that no automated
# test makes an external AI call, and this is what guarantees it: the mock
# provider contains no network code and no credentials, so a test cannot reach
# a vendor even by accident. Tests that exercise the real provider inject a
# stub client instead (tests/ai/test_anthropic_provider.py).
#
# The key is blanked rather than left unset so a developer's exported
# AI_API_KEY cannot flip the suite onto a live provider — and be billed for it.
# ---------------------------------------------------------------------------

AI_PROVIDER = "mock"
AI_API_KEY = ""

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

# In-process substitutes for Redis, so the suite runs without a broker. Both
# are only correct because tests run in one process — which is exactly the
# assumption production must not make, hence the Redis backends in base.py.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "streamsync-test",
    },
}

CHANNEL_LAYERS = {
    "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"},
}

# Celery tasks execute inline, in the calling process, with no broker. What
# that buys is that a test can assert on a notification the moment the request
# returns; what it costs is that it proves nothing about serialisation or
# worker behaviour. Tests that care about retry semantics call the task
# function directly instead of relying on this.
CELERY_TASK_ALWAYS_EAGER = True

# Without this a failing task is swallowed and the test sees only a missing
# notification. Propagating turns the real exception into the test failure.
CELERY_TASK_EAGER_PROPAGATES = True

CELERY_BROKER_URL = "memory://"
CELERY_RESULT_BACKEND = "cache+memory://"

# Keeping migrations in the loop means the suite verifies that the migration
# graph actually builds the schema the models describe.
DATABASES["default"]["CONN_MAX_AGE"] = 0

# Quieter output; failures still surface through pytest's captured logs.
LOGGING["root"]["level"] = env("DJANGO_LOG_LEVEL", default="WARNING")
