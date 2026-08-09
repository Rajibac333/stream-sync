#!/usr/bin/env bash
#
# Container entrypoint: block until PostgreSQL answers, then hand off to the
# command in CMD.
#
set -euo pipefail

echo "[entrypoint] waiting for the database..."

# Waiting here rather than in the application means a container started before
# its database is not counted as a crash by the orchestrator.
ATTEMPTS=0
MAX_ATTEMPTS="${DB_WAIT_MAX_ATTEMPTS:-30}"

until python - <<'PY'
import sys

import django

django.setup()

from django.db import connections  # noqa: E402

try:
    connections["default"].ensure_connection()
except Exception:
    sys.exit(1)
sys.exit(0)
PY
do
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ "${ATTEMPTS}" -ge "${MAX_ATTEMPTS}" ]; then
        echo "[entrypoint] database unreachable after ${MAX_ATTEMPTS} attempts" >&2
        exit 1
    fi
    echo "[entrypoint] database not ready (${ATTEMPTS}/${MAX_ATTEMPTS}), retrying..."
    sleep 2
done

echo "[entrypoint] database is ready"

# Opt-in rather than automatic: running migrations on every container start
# means N replicas racing on the same schema during a rolling deploy. Real
# deployments run this once, as a separate job.
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
    echo "[entrypoint] applying migrations"
    python manage.py migrate --noinput
fi

echo "[entrypoint] starting: $*"
exec "$@"
