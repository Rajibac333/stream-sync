"""
Settings shared by every environment.

Nothing in this module may be environment-specific. `development.py`,
`production.py` and `test.py` import everything from here and then override
only what genuinely differs, so there is a single place to read when asking
"how is this project configured?" (README §3)

Configuration is read from the environment, never hardcoded. (README §29)
"""

from datetime import timedelta
from pathlib import Path

import environ

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# BASE_DIR is the backend project root — the directory holding manage.py.
BASE_DIR = Path(__file__).resolve().parents[2]

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

env = environ.Env()

# A local .env is a developer convenience. It is absent in production, where
# configuration arrives through real environment variables, so this read is
# deliberately optional. .env is git-ignored and must never hold committed
# secrets. (README §25, §29)
_env_file = BASE_DIR / ".env"
if _env_file.is_file():
    environ.Env.read_env(_env_file)

# No default: every environment must supply a key. Each settings module decides
# whether to fall back (development) or fail loudly (production).
SECRET_KEY = env("DJANGO_SECRET_KEY", default=None)

DEBUG = False

ALLOWED_HOSTS: list[str] = env.list("DJANGO_ALLOWED_HOSTS", default=[])

# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------

DJANGO_APPS = [
    # Must precede django.contrib.staticfiles: daphne overrides `runserver`
    # with an ASGI server, so WebSockets work in local development without a
    # second process. Ordering is how that override is registered.
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "channels",
    "rest_framework",
    # Stores revoked refresh tokens. Without it a refresh token stays valid
    # until it expires, so "log out" would not actually end the session.
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "drf_spectacular",
]

# Product apps. Grows one entry per milestone; see README §32.
LOCAL_APPS = [
    "apps.core",
    "apps.accounts",
    "apps.workspaces",
    "apps.projects",
    "apps.documents",
    "apps.tasks",
    "apps.comments",
    "apps.activity",
    "apps.collaboration",
    "apps.notifications",
    "apps.ai",
    "apps.search",
    "apps.dashboard",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ---------------------------------------------------------------------------
# Middleware
#
# Order matters. RequestIDMiddleware runs first so every log record emitted
# during the request — including ones from security middleware — carries a
# correlation id. CORS must precede CommonMiddleware so that redirects it
# issues still carry the CORS headers.
# ---------------------------------------------------------------------------

MIDDLEWARE = [
    "common.middleware.request_id.RequestIDMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# ---------------------------------------------------------------------------
# Database
#
# PostgreSQL only. SQLite is never used, including for tests, so that
# PostgreSQL-specific behaviour (UUID keys, constraints, full-text search)
# is exercised by the suite exactly as it runs in production. (README §4)
# ---------------------------------------------------------------------------

DATABASES = {
    "default": env.db_url(
        "DATABASE_URL",
        default="postgres://streamsync:streamsync@localhost:5432/streamsync",
    ),
}

# Reuse connections across requests instead of reconnecting every time.
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DJANGO_CONN_MAX_AGE", default=60)
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True
DATABASES["default"]["ATOMIC_REQUESTS"] = False

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

# Email-identified custom user. Swapping this after migrations exist is
# painful, which is why it is set in the very first milestone. (README §5)
AUTH_USER_MODEL = "accounts.User"

_PASSWORD_VALIDATION = "django.contrib.auth.password_validation"

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": f"{_PASSWORD_VALIDATION}.UserAttributeSimilarityValidator",
        "OPTIONS": {"user_attributes": ("email", "name")},
    },
    {
        "NAME": f"{_PASSWORD_VALIDATION}.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": f"{_PASSWORD_VALIDATION}.CommonPasswordValidator"},
    {"NAME": f"{_PASSWORD_VALIDATION}.NumericPasswordValidator"},
]

# Django's default. Explicit here because auth is security-critical and the
# value should be reviewed, not inherited silently.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
]

LOGIN_URL = "/admin/login/"

# ---------------------------------------------------------------------------
# Django REST Framework
#
# Authentication classes are intentionally empty: JWT is Milestone 2. Leaving
# DRF's defaults in place would silently enable BasicAuthentication, so the
# list is set explicitly rather than left to chance.
# ---------------------------------------------------------------------------

REST_FRAMEWORK = {
    # JWT only. DRF's own default would additionally enable
    # BasicAuthentication, which would accept a password on every request.
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    # Deny by default. Endpoints that are genuinely public opt out explicitly.
    # (README §2, §20)
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
    ],
    # Every list endpoint is paginated. (README §48)
    "DEFAULT_PAGINATION_CLASS": "common.pagination.DefaultPagination",
    "PAGE_SIZE": 25,
    # Uniform {"error": {"code", "message"}} bodies. (README §18)
    "EXCEPTION_HANDLER": "common.exceptions.api_exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    # Baseline abuse protection. Sensitive endpoints (login, register, AI) add
    # their own tighter scopes in the milestones that introduce them.
    # (README §24)
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": env("DJANGO_THROTTLE_ANON", default="60/min"),
        "user": env("DJANGO_THROTTLE_USER", default="1000/hour"),
        # Credential endpoints, throttled per IP. Tight enough to make online
        # password guessing impractical, loose enough that a person who
        # mistypes a password several times is not locked out. (README §24)
        "auth_login": env("DJANGO_THROTTLE_LOGIN", default="10/min"),
        "auth_register": env("DJANGO_THROTTLE_REGISTER", default="5/hour"),
        # Refresh is keyed on the *session's user*, not the client address
        # (apps/accounts/throttles.py), so this is a per-account budget rather
        # than a per-office one. It is called on every page load, and a person
        # with several tabs open across a working day legitimately spends a lot
        # of it — hence far more headroom than login, which is per-IP because
        # the caller there is anonymous by definition. A request with no cookie
        # still falls back to per-IP and spends the same budget.
        "auth_refresh": env("DJANGO_THROTTLE_REFRESH", default="240/hour"),
        # Invitations. A write that reaches a person — a notification now, mail
        # once the pipeline exists — so it is capped well below the general
        # per-user limit. Generous for onboarding a team. (README §24)
        "workspace_invite": env("DJANGO_THROTTLE_INVITE", default="30/hour"),
        # AI endpoints, per user. The only requests in the product that cost
        # money at a third party, so they get their own budget rather than
        # sharing the general one. Two windows: the burst limit catches a
        # client stuck in a retry loop, the sustained limit bounds what one
        # account can spend in an hour. (README §24, Milestone 9)
        "ai_burst": env("DJANGO_THROTTLE_AI_BURST", default="10/min"),
        "ai": env("DJANGO_THROTTLE_AI", default="60/hour"),
    },
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
    "UNAUTHENTICATED_USER": "django.contrib.auth.models.AnonymousUser",
}

# ---------------------------------------------------------------------------
# JWT
#
# Split-lifetime design, matching what the frontend already expects:
#
#   access token   short-lived, returned in the response body, held only in
#                  browser memory (StreamSyncFrontend/src/api/tokenStorage.ts)
#   refresh token  long-lived, delivered as an httpOnly cookie so JavaScript
#                  can never read it — an XSS then cannot steal a durable
#                  credential
#
# (README §19, §25)
# ---------------------------------------------------------------------------

ACCESS_TOKEN_LIFETIME = timedelta(
    minutes=env.int("JWT_ACCESS_TOKEN_LIFETIME_MINUTES", default=15)
)
REFRESH_TOKEN_LIFETIME = timedelta(
    days=env.int("JWT_REFRESH_TOKEN_LIFETIME_DAYS", default=7)
)

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": ACCESS_TOKEN_LIFETIME,
    "REFRESH_TOKEN_LIFETIME": REFRESH_TOKEN_LIFETIME,
    # Each refresh mints a new refresh token and blacklists the one presented.
    # A stolen refresh token is therefore usable at most once, and its reuse
    # after the legitimate client has rotated is detectable.
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    # Login already records this; leaving it off avoids a second write per
    # token refresh.
    "UPDATE_LAST_LOGIN": False,
    "ALGORITHM": "HS256",
    # Defaults to SECRET_KEY. A separate key lets JWT signing be rotated
    # without invalidating sessions, password-reset links and signed cookies
    # all at once.
    "SIGNING_KEY": env("JWT_SIGNING_KEY", default=SECRET_KEY),
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "TOKEN_TYPE_CLAIM": "token_type",
    # Uniquely identifies a token so it can be blacklisted individually.
    "JTI_CLAIM": "jti",
}

# ---------------------------------------------------------------------------
# Refresh cookie
# ---------------------------------------------------------------------------

# Scoped to the auth endpoints: the browser then never attaches the refresh
# token to ordinary API calls, so it is not exposed on every request.
REFRESH_COOKIE_NAME = env("JWT_REFRESH_COOKIE_NAME", default="streamsync_refresh")
REFRESH_COOKIE_PATH = env("JWT_REFRESH_COOKIE_PATH", default="/api/auth/")

# Overridden to True in production. Kept configurable because a Secure cookie
# is dropped by the browser over plain http, which would break local development.
REFRESH_COOKIE_SECURE = env.bool("JWT_REFRESH_COOKIE_SECURE", default=False)

# "Lax" is correct while the frontend and API share a registrable domain
# (localhost:5173 -> localhost:8000, or app.example.com -> api.example.com).
# A genuinely cross-site deployment needs "None", which the browser only
# honours together with Secure.
REFRESH_COOKIE_SAMESITE = env("JWT_REFRESH_COOKIE_SAMESITE", default="Lax")

# ---------------------------------------------------------------------------
# Google Sign-In
#
# ID-token flow only: the frontend renders Google's own "Sign in with Google"
# button (Google Identity Services), which returns a signed ID token directly
# to the browser. That token is POSTed to /api/auth/google/ and verified here
# against Google's public keys — no OAuth redirect, no client secret, and no
# server-side call to Google is made at request time beyond fetching Google's
# published certificates (cached by the google-auth library).
#
# The client ID is not a secret — it identifies the application, the same way
# a domain name does, and Google's own docs say it is safe to embed in
# frontend code. It is still read from the environment rather than hardcoded,
# because it differs between local, staging and production OAuth clients.
# ---------------------------------------------------------------------------

GOOGLE_OAUTH_CLIENT_ID = env("GOOGLE_OAUTH_CLIENT_ID", default="")

SPECTACULAR_SETTINGS = {
    "TITLE": "StreamSync API",
    "DESCRIPTION": (
        "Real-time collaborative workspace backend. "
        "Workspaces, projects, documents, tasks, activity and AI assistance."
    ),
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": "/api",
    "COMPONENT_SPLIT_REQUEST": True,
    "SORT_OPERATIONS": False,
    # `role` appears with two different choice sets — every role when reading a
    # member, and the assignable subset (editor/viewer) when inviting, since
    # ownership is transferred rather than granted. Without these names the
    # generator resolves the collision itself and emits something like
    # "Role1c6Enum" into every generated client. Resolved lazily from these
    # dotted paths, so settings does not import app code at load time.
    "ENUM_NAME_OVERRIDES": {
        "WorkspaceRole": "apps.workspaces.models.WorkspaceRole.choices",
        "AssignableWorkspaceRole": "apps.workspaces.models.ASSIGNABLE_ROLE_CHOICES",
        "MembershipStatus": "apps.workspaces.models.MembershipStatus.choices",
        # `status` means three different things — a membership's, a project's
        # and a task's — so each needs naming or the generator invents one and
        # every generated client inherits it.
        "ProjectStatus": "apps.projects.models.ProjectStatus.choices",
        "TaskStatus": "apps.tasks.models.TaskStatus.choices",
        "TaskPriority": "apps.tasks.models.TaskPriority.choices",
        "CommentResource": "apps.comments.models.CommentResource.choices",
        # The AI vocabulary. `mode` and `tone` are generic enough that the
        # generator would name them after the first operation that used them.
        "AiRewriteMode": "apps.ai.constants.AiRewriteMode.choices",
        "AiTone": "apps.ai.constants.AiTone.choices",
        "AiAssigneeSource": "apps.ai.constants.AiAssigneeSource.choices",
    },
}

# ---------------------------------------------------------------------------
# CORS
#
# The Vite frontend runs on a different origin, so it is cross-origin by
# definition. Origins are always an explicit allow-list — never a wildcard —
# because credentials are permitted. (README §25)
# ---------------------------------------------------------------------------

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = True

# Only the API is cross-origin. The admin is same-origin and must not be
# reachable from a third-party page.
CORS_URLS_REGEX = r"^/api/.*$"

CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

# ---------------------------------------------------------------------------
# Cache
#
# Backs DRF throttling today; Redis replaces the local-memory backend once it
# is introduced alongside Channels and Celery. (README §23)
# ---------------------------------------------------------------------------

REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")

CACHES = {
    "default": {
        # Redis, so the presence roster is shared by every worker. A
        # per-process cache would give each worker its own idea of who is in a
        # document, which is worse than no presence at all.
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    },
}

# ---------------------------------------------------------------------------
# Channels
#
# The channel layer is the fan-out bus: a broadcast from the worker holding one
# socket has to reach clients held by every other worker. In-memory would work
# only while there is exactly one process, which is true in development and
# never true in production. (README §23, §54)
# ---------------------------------------------------------------------------

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [REDIS_URL],
            # Bounds how much one slow consumer can buffer before the layer
            # starts dropping for it, rather than growing without limit.
            "capacity": 512,
            "expiry": 30,
        },
    },
}

# ---------------------------------------------------------------------------
# Celery
#
# Background work so an HTTP request never waits on something the user did not
# ask for. Redis is both broker and result backend — it is already a hard
# dependency for the channel layer, and adding a second piece of
# infrastructure to carry a notification queue would not earn its keep.
# (README §22, §23)
# ---------------------------------------------------------------------------

CELERY_BROKER_URL = env("CELERY_BROKER_URL", default=REDIS_URL)
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default=REDIS_URL)

# JSON only. Celery's historical default was pickle, which executes arbitrary
# code on deserialisation — anyone who can write to the queue owns the worker.
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"

# Stated literally rather than as `TIME_ZONE`, which is defined further down
# this module. It must stay in step with it — both are UTC, and everything the
# product stores is UTC. (README §4)
CELERY_TIMEZONE = "UTC"
CELERY_ENABLE_UTC = True

# Acknowledge *after* the task finishes, so a task whose worker dies mid-run is
# redelivered rather than lost. This is only safe because the tasks are
# idempotent — see apps/notifications/tasks.py.
CELERY_TASK_ACKS_LATE = True

# A worker that dies mid-task returns its work to the queue.
CELERY_TASK_REJECT_ON_WORKER_LOST = True

# One task at a time per worker process. The default of four prefetches work
# that then sits idle behind a slow task on the same process.
CELERY_WORKER_PREFETCH_MULTIPLIER = 1

# A stuck task is killed rather than pinning a worker forever. Soft first, so
# the task can raise and clean up before the hard kill.
CELERY_TASK_SOFT_TIME_LIMIT = 60
CELERY_TASK_TIME_LIMIT = 120

# Results are only used for debugging; keeping them a day is plenty and stops
# Redis filling with dead result keys.
CELERY_RESULT_EXPIRES = 60 * 60 * 24

# Nothing reads the result of a notification task. Storing one costs a second
# Redis round trip per task and — worse — makes `.delay()` wait on the *result
# backend* as well as the broker, which is a second thing that can hang a
# request when Redis is unwell.
CELERY_TASK_IGNORE_RESULT = True

CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True

# Fail fast when the broker is unreachable. The defaults retry for around
# twenty seconds, and because dispatch happens inside `transaction.on_commit`
# that delay lands directly on a user's request — a Redis outage would turn
# every write into a timeout. Two seconds and no retries means the enqueue
# gives up quickly and `common.tasks.enqueue` logs it.
CELERY_BROKER_CONNECTION_MAX_RETRIES = 0
CELERY_BROKER_TRANSPORT_OPTIONS = {
    "socket_connect_timeout": 2,
    "socket_timeout": 2,
    "retry_on_timeout": False,
}

# ---------------------------------------------------------------------------
# AI
#
# The provider key is read here and nowhere else. It is server-side only: it
# never reaches a serializer, a log record, an error payload or a template, and
# there is no VITE_-prefixed equivalent, because anything with that prefix is
# shipped to the browser. (README §14, §25, §29; frontend CLAUDE.md §50)
#
# The default provider follows the key. A checkout with no credentials runs the
# deterministic provider in apps/ai/providers/mock.py — which reads the
# document and answers with rules, stamps every result `mock-heuristic`, and
# opens no sockets. That last property is what makes "no external AI calls
# during tests" a structural fact rather than a convention.
# ---------------------------------------------------------------------------

AI_API_KEY = env("AI_API_KEY", default="")

AI_PROVIDER = env("AI_PROVIDER", default="anthropic" if AI_API_KEY else "mock")

# Model id is provider-shaped — Claude models and Groq-hosted models live in
# different namespaces — so the default follows AI_PROVIDER rather than being
# one hardcoded string every non-Anthropic deployment has to override.
_AI_MODEL_DEFAULTS = {
    "anthropic": "claude-opus-5",
    # Confirmed against Groq's own structured-outputs example: this is the
    # model they document `response_format={"type": "json_schema", ...}`
    # against, which is exactly the constrained-decoding mode this app relies
    # on for every provider.
    "groq": "openai/gpt-oss-20b",
}
AI_MODEL = env("AI_MODEL", default=_AI_MODEL_DEFAULTS.get(AI_PROVIDER, "claude-opus-5"))

# How much reasoning to buy. These are extraction and rewriting tasks over a
# document that is already in the prompt, not open-ended research, so the
# middle setting is the right starting point — raise it if summaries of long
# documents start missing structure.
AI_EFFORT = env("AI_EFFORT", default="medium")

# A hard budget for one provider call. Someone is watching a spinner: past this
# point the answer has stopped being useful, and holding the worker open no
# longer helps them.
AI_TIMEOUT_SECONDS = env.float("AI_TIMEOUT_SECONDS", default=45.0)

# One retry on top of the first attempt. More would multiply the user's wait by
# the retry count for a request that is already slow.
AI_MAX_RETRIES = env.int("AI_MAX_RETRIES", default=1)

# Caps the response. It bounds thinking *and* answer together, so it needs
# headroom above the size of the JSON — a reply cut off mid-object is not
# parseable, and arrives as an error rather than a partial summary.
AI_MAX_OUTPUT_TOKENS = env.int("AI_MAX_OUTPUT_TOKENS", default=8000)

# How much of a document the assistant may read. Longer bodies are truncated,
# and the prompt says so — a model that believes it has seen everything will
# confidently report that something is absent.
AI_MAX_DOCUMENT_CHARS = env.int("AI_MAX_DOCUMENT_CHARS", default=60_000)

# ---------------------------------------------------------------------------
# Internationalisation
# ---------------------------------------------------------------------------

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
# All timestamps are stored and served in UTC; clients localise. (README §4)
USE_TZ = True

# ---------------------------------------------------------------------------
# Static and media
# ---------------------------------------------------------------------------

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# ---------------------------------------------------------------------------
# Security defaults
#
# Values here are safe everywhere; production.py tightens them further.
# ---------------------------------------------------------------------------

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# Django's own default here — "same-origin" — silently breaks Google Sign-In.
# GIS authenticates through a popup (or an invisible one for FedCM) and
# reports the result back to this page via `window.postMessage`; the browser
# refuses that call under a strict same-origin COOP policy, so the button
# looks like it does nothing. "same-origin-allow-popups" keeps this page
# isolated from *other* windows it opens while still letting a popup it opened
# talk back to it — the narrowest setting that Google's own integration
# guidance recommends for exactly this conflict.
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin-allow-popups"

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"

# Trust the proxy's protocol header so Django knows a request arrived over TLS
# when it is terminated upstream.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024  # 5 MB

# ---------------------------------------------------------------------------
# Logging
#
# Records carry the request id so a single request can be traced end to end.
# Secrets, passwords and tokens are never logged. (README §31)
# ---------------------------------------------------------------------------

LOG_LEVEL = env("DJANGO_LOG_LEVEL", default="INFO")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_id": {
            "()": "common.middleware.request_id.RequestIDFilter",
        },
    },
    "formatters": {
        "console": {
            "()": "common.logging.ConsoleFormatter",
            "format": "%(levelname)s %(asctime)s [%(request_id)s] %(name)s %(message)s",
        },
        "json": {
            "()": "common.logging.JSONFormatter",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "filters": ["request_id"],
            "formatter": "console",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": LOG_LEVEL,
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        # Unhandled exceptions inside views. Kept at ERROR so 4xx noise from
        # django.request does not drown real failures.
        "django.request": {
            "handlers": ["console"],
            "level": "ERROR",
            "propagate": False,
        },
        "streamsync": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
    },
}

# ---------------------------------------------------------------------------
# Project metadata
# ---------------------------------------------------------------------------

# Reported by the health endpoint so a deployed instance can be identified.
SERVICE_NAME = "streamsync-backend"
SERVICE_VERSION = env("SERVICE_VERSION", default="1.0.0")
SERVICE_ENVIRONMENT = env("SERVICE_ENVIRONMENT", default="local")
