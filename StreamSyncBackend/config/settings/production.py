"""
Production settings.

Every value that would be a security hole if misconfigured is read from the
environment with no default, so a missing variable fails at boot rather than
silently degrading protection in a running deployment. (README §25)
"""

from .base import *
from .base import LOGGING, env

DEBUG = False

# No default. `environ` raises ImproperlyConfigured if these are absent, which
# is the intended behaviour — refusing to start beats starting insecurely.
SECRET_KEY = env("DJANGO_SECRET_KEY")
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS")
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS")
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=CORS_ALLOWED_ORIGINS)

# ---------------------------------------------------------------------------
# Transport security
# ---------------------------------------------------------------------------

SECURE_SSL_REDIRECT = env.bool("DJANGO_SECURE_SSL_REDIRECT", default=True)

# One year, matching the HSTS preload requirement. Only meaningful once the
# domain genuinely serves HTTPS everywhere, so it stays overridable.
SECURE_HSTS_SECONDS = env.int("DJANGO_SECURE_HSTS_SECONDS", default=31_536_000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool(
    "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS", default=True
)
SECURE_HSTS_PRELOAD = env.bool("DJANGO_SECURE_HSTS_PRELOAD", default=True)

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# The refresh cookie is a long-lived credential. Not negotiable over plain
# http, so this is forced rather than read from the environment. (README §25)
REFRESH_COOKIE_SECURE = True

# ---------------------------------------------------------------------------
# Static files
#
# WhiteNoise serves hashed, compressed assets directly from the app container.
# ---------------------------------------------------------------------------

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# ---------------------------------------------------------------------------
# Logging
#
# Machine-parseable output for log aggregation. (README §31)
# ---------------------------------------------------------------------------

LOGGING = {
    **LOGGING,
    "handlers": {
        **LOGGING["handlers"],
        "console": {
            **LOGGING["handlers"]["console"],
            "formatter": "json",
        },
    },
}

SERVICE_ENVIRONMENT = env("SERVICE_ENVIRONMENT", default="production")
