# StreamSync backend image.
#
# Two stages so build tooling never ships to production: `builder` compiles
# wheels, `runtime` installs them into a slim base. Build context is the
# backend root:
#
#     docker build -f docker/Dockerfile -t streamsync-backend .

# ---------------------------------------------------------------------------
# Stage 1 — build wheels
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# build-essential covers any dependency without a prebuilt wheel for this
# platform. It stays in this stage and never reaches the runtime image.
RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential \
    && rm -rf /var/lib/apt/lists/*

# Requirements are copied alone so Docker's layer cache survives every source
# change — dependencies are only reinstalled when these files change.
COPY requirements/ requirements/

ARG REQUIREMENTS=production
RUN pip wheel --wheel-dir /wheels -r requirements/${REQUIREMENTS}.txt

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_SETTINGS_MODULE=config.settings.production

# libpq5 is the PostgreSQL client library psycopg links against at runtime.
# curl backs the container HEALTHCHECK below.
RUN apt-get update \
    && apt-get install --no-install-recommends -y libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

# A container process that runs as root can escalate a container escape into a
# host compromise. This one never runs as root. (README §25)
RUN groupadd --system --gid 1001 streamsync \
    && useradd --system --uid 1001 --gid streamsync --create-home streamsync

WORKDIR /app

COPY --from=builder /wheels /wheels
RUN pip install --no-index --find-links=/wheels /wheels/* \
    && rm -rf /wheels

COPY --chown=streamsync:streamsync . .

RUN chmod +x docker/entrypoint.sh \
    && mkdir -p /app/staticfiles /app/media \
    && chown -R streamsync:streamsync /app/staticfiles /app/media

# Baked into the image so a container start never waits on collectstatic. The
# placeholder key is used only by this build step — the real key comes from the
# environment at runtime and is never stored in a layer.
RUN DJANGO_SECRET_KEY=build-time-placeholder-not-used-at-runtime \
    DJANGO_ALLOWED_HOSTS=localhost \
    CORS_ALLOWED_ORIGINS=http://localhost \
    python manage.py collectstatic --noinput --clear

USER streamsync

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail http://localhost:8000/api/health/ || exit 1

ENTRYPOINT ["./docker/entrypoint.sh"]

# ASGI, not WSGI: WebSockets cannot be served over WSGI, and the API and the
# sockets share one deployment. gunicorn stays as the process manager and
# supervises uvicorn workers, which is the combination that gives graceful
# restarts *and* async request handling.
#
# --timeout must exceed the slowest legitimate request. The AI endpoints are
# that request: AI_TIMEOUT_SECONDS (45s) with one retry is ~90s worst case, so
# a 60s worker timeout would kill the worker mid-request and return an opaque
# 502 instead of the AI_TIMEOUT the application would otherwise produce. The
# application's own budget stays the real cap; this is only the backstop for a
# genuinely wedged worker.
CMD ["gunicorn", "config.asgi:application", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
