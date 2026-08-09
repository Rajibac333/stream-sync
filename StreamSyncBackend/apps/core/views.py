"""
Operational endpoints.

`core` holds infrastructure-level concerns that belong to no product domain.
Two endpoints, because orchestrators ask two different questions:

  liveness  — "is this process healthy, or should it be restarted?"
  readiness — "can this instance serve traffic right now?"

Conflating them causes outages: a database blip would fail a combined check,
the orchestrator would kill every pod, and the restarts would not bring the
database back any faster.
"""

import logging
from typing import Any

from django.conf import settings
from django.db import connections
from django.utils import timezone
from drf_spectacular.utils import OpenApiExample, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger("streamsync.health")


class BaseHealthView(APIView):
    """
    Shared configuration for probe endpoints.

    Public and unthrottled: these are polled continuously by load balancers and
    uptime monitors, and a probe that starts returning 401 or 429 under load
    reports an outage that is not happening. They expose no user data.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []


class HealthView(BaseHealthView):
    """Liveness probe. Touches no dependency, so it answers fast and cheaply."""

    @extend_schema(
        operation_id="health",
        summary="Liveness probe",
        description=(
            "Returns 200 whenever the process can serve requests. Checks no "
            "external dependency — use the readiness probe for that."
        ),
        responses={200: dict},
        examples=[
            OpenApiExample(
                "Healthy",
                value={
                    "status": "ok",
                    "service": "streamsync-backend",
                    "version": "1.0.0",
                    "environment": "local",
                    "time": "2026-08-03T10:15:00+00:00",
                },
                response_only=True,
            )
        ],
        tags=["health"],
    )
    def get(self, request: Request) -> Response:
        return Response(
            {
                "status": "ok",
                "service": settings.SERVICE_NAME,
                "version": settings.SERVICE_VERSION,
                "environment": settings.SERVICE_ENVIRONMENT,
                "time": timezone.now().isoformat(),
            }
        )


class ReadinessView(BaseHealthView):
    """
    Readiness probe. Verifies the dependencies a request actually needs.

    Returns 503 when any check fails so a load balancer removes this instance
    from rotation instead of routing requests it cannot fulfil.
    """

    @extend_schema(
        operation_id="health_ready",
        summary="Readiness probe",
        description=(
            "Verifies every backing service this instance needs. Returns 200 "
            "when all checks pass and 503 when any of them fails."
        ),
        responses={200: dict, 503: dict},
        tags=["health"],
    )
    def get(self, request: Request) -> Response:
        checks = {
            "database": self._check_database(),
            "cache": self._check_cache(),
        }

        healthy = all(check["status"] == "ok" for check in checks.values())

        return Response(
            {
                "status": "ok" if healthy else "degraded",
                "service": settings.SERVICE_NAME,
                "version": settings.SERVICE_VERSION,
                "environment": settings.SERVICE_ENVIRONMENT,
                "time": timezone.now().isoformat(),
                "checks": checks,
            },
            status=status.HTTP_200_OK
            if healthy
            else status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    @staticmethod
    def _check_database() -> dict[str, Any]:
        """
        Round-trips a trivial query.

        `SELECT 1` proves the connection is genuinely usable, which
        `connection.is_usable()` alone does not guarantee for a connection that
        has been idle in the pool.
        """
        try:
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except Exception as exc:
            # The exception text can contain the host and credentials from the
            # DSN, so it goes to the log and never into the response body.
            logger.error(
                "Database readiness check failed",
                extra={"check": "database", "exception_type": type(exc).__name__},
            )
            return {"status": "error", "detail": "unreachable"}
        return {"status": "ok"}

    @staticmethod
    def _check_cache() -> dict[str, Any]:
        """Writes and reads one key. Backs throttling today, Channels later."""
        from django.core.cache import cache

        probe_key = "healthcheck:probe"
        try:
            cache.set(probe_key, "ok", timeout=10)
            if cache.get(probe_key) != "ok":
                return {"status": "error", "detail": "read-back mismatch"}
        except Exception as exc:
            logger.error(
                "Cache readiness check failed",
                extra={"check": "cache", "exception_type": type(exc).__name__},
            )
            return {"status": "error", "detail": "unreachable"}
        return {"status": "ok"}
