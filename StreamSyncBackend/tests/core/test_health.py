"""
Health endpoint behaviour.

These are the contract an orchestrator depends on, so the important assertions
are about status codes and public access rather than payload cosmetics.
"""

from contextlib import contextmanager
from unittest import mock

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@contextmanager
def unreachable_database(message: str):
    """
    Simulate a database outage inside the readiness view.

    The whole `connections` object is replaced rather than its `__getitem__`,
    because Python resolves special methods on the type and never on the
    instance — patching the method alone silently does nothing and leaves the
    test passing for the wrong reason.
    """
    with mock.patch("apps.core.views.connections") as connections:
        connections.__getitem__.side_effect = OSError(message)
        yield connections


class TestLivenessEndpoint:
    def test_returns_ok_without_authentication(self, api_client: APIClient) -> None:
        """Probes are unauthenticated; requiring a token would break them."""
        response = api_client.get(reverse("core:health"))

        assert response.status_code == 200
        assert response.data["status"] == "ok"

    def test_reports_service_identity(self, api_client: APIClient) -> None:
        """Lets an operator confirm which build answered."""
        response = api_client.get(reverse("core:health"))

        assert response.data["service"] == "streamsync-backend"
        assert response.data["version"]
        assert response.data["environment"]
        assert response.data["time"]

    def test_rejects_post(self, api_client: APIClient) -> None:
        response = api_client.post(reverse("core:health"), {})

        assert response.status_code == 405
        assert response.data["error"]["code"] == "METHOD_NOT_ALLOWED"

    def test_response_carries_request_id_header(self, api_client: APIClient) -> None:
        response = api_client.get(reverse("core:health"))

        assert response.headers["X-Request-ID"]

    def test_echoes_supplied_request_id(self, api_client: APIClient) -> None:
        """Lets a trace span the proxy, the frontend and the backend."""
        response = api_client.get(
            reverse("core:health"), headers={"x-request-id": "trace-abc-123"}
        )

        assert response.headers["X-Request-ID"] == "trace-abc-123"

    def test_strips_unsafe_characters_from_request_id(
        self, api_client: APIClient
    ) -> None:
        """The header is client input and must not reach logs unsanitised."""
        response = api_client.get(
            reverse("core:health"), headers={"x-request-id": "abc\r\ninjected: yes"}
        )

        # The CRLF and the colon are gone, so the value cannot forge a second
        # header or a second log line.
        assert response.headers["X-Request-ID"] == "abcinjectedyes"


class TestReadinessEndpoint:
    def test_reports_ok_when_dependencies_are_reachable(
        self, api_client: APIClient
    ) -> None:
        response = api_client.get(reverse("core:readiness"))

        assert response.status_code == 200
        assert response.data["status"] == "ok"
        assert response.data["checks"]["database"]["status"] == "ok"
        assert response.data["checks"]["cache"]["status"] == "ok"

    def test_reports_503_when_database_is_unreachable(
        self, api_client: APIClient
    ) -> None:
        """A load balancer must pull this instance out of rotation, not 200."""
        with unreachable_database("connection refused"):
            response = api_client.get(reverse("core:readiness"))

        assert response.status_code == 503
        assert response.data["status"] == "degraded"
        assert response.data["checks"]["database"]["status"] == "error"

    def test_does_not_leak_connection_details_on_failure(
        self, api_client: APIClient
    ) -> None:
        """A DSN in an error body would publish the database password."""
        with unreachable_database("could not connect to postgres://user:hunter2@db"):
            response = api_client.get(reverse("core:readiness"))

        assert "hunter2" not in str(response.data)
        assert response.data["checks"]["database"]["detail"] == "unreachable"
