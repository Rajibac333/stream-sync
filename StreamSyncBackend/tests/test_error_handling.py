"""
The uniform error envelope.

Every failure the API produces must arrive as
{"error": {"code", "message"}} so the frontend needs one branch for errors and
never has to parse a message string. (README §18)
"""

import logging

import pytest
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404
from rest_framework import exceptions as drf_exceptions
from rest_framework.test import APIClient

from common.exceptions import (
    ApplicationError,
    ConflictError,
    ErrorCode,
    api_exception_handler,
)


def handle(exc: Exception):
    """Invoke the handler the way DRF does, with an empty view context."""
    return api_exception_handler(exc, {"view": None, "request": None})


class TestErrorEnvelope:
    @pytest.mark.parametrize(
        ("exception", "expected_code", "expected_status"),
        [
            (drf_exceptions.NotFound(), ErrorCode.NOT_FOUND, 404),
            (Http404(), ErrorCode.NOT_FOUND, 404),
            (
                drf_exceptions.NotAuthenticated(),
                ErrorCode.AUTHENTICATION_REQUIRED,
                401,
            ),
            (
                drf_exceptions.AuthenticationFailed(),
                ErrorCode.AUTHENTICATION_FAILED,
                401,
            ),
            (drf_exceptions.PermissionDenied(), ErrorCode.PERMISSION_DENIED, 403),
            (DjangoPermissionDenied(), ErrorCode.PERMISSION_DENIED, 403),
            (drf_exceptions.ParseError(), ErrorCode.PARSE_ERROR, 400),
            (drf_exceptions.Throttled(), ErrorCode.THROTTLED, 429),
            (ConflictError(), ErrorCode.CONFLICT, 409),
        ],
    )
    def test_maps_exceptions_to_stable_codes(
        self, exception: Exception, expected_code: str, expected_status: int
    ) -> None:
        response = handle(exception)

        assert response.status_code == expected_status
        assert response.data["error"]["code"] == expected_code
        assert response.data["error"]["message"]

    def test_body_contains_only_the_error_key(self) -> None:
        response = handle(drf_exceptions.NotFound())

        assert set(response.data) == {"error"}

    def test_validation_errors_carry_per_field_details(self) -> None:
        """The frontend attaches these to the field that produced them."""
        exc = drf_exceptions.ValidationError(
            {"email": ["Enter a valid email address."], "name": ["This is required."]}
        )

        response = handle(exc)

        assert response.status_code == 400
        assert response.data["error"]["code"] == ErrorCode.VALIDATION_ERROR
        assert response.data["error"]["details"]["email"] == [
            "Enter a valid email address."
        ]

    def test_application_errors_keep_their_own_code(self) -> None:
        """Service-layer errors surface as themselves, not as a generic 400."""
        response = handle(
            ApplicationError("Workspace slug already taken.", code="SLUG_TAKEN")
        )

        assert response.data["error"]["code"] == "SLUG_TAKEN"
        assert response.data["error"]["message"] == "Workspace slug already taken."

    def test_application_errors_can_attach_structured_context(self) -> None:
        response = handle(
            ApplicationError(
                "Workspace slug already taken.",
                code="SLUG_TAKEN",
                extra={"field": "slug"},
            )
        )

        assert response.data["error"]["details"] == {"field": "slug"}

    def test_preserves_retry_after_on_throttling(self) -> None:
        """Dropping this header leaves a well-behaved client guessing."""
        response = handle(drf_exceptions.Throttled(wait=30))

        assert response.status_code == 429
        assert "Retry-After" in response.headers

    def test_preserves_www_authenticate_on_401(self) -> None:
        exc = drf_exceptions.NotAuthenticated()
        exc.auth_header = 'Bearer realm="api"'

        response = handle(exc)

        assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


class TestUnexpectedExceptions:
    def test_returns_an_opaque_500_outside_debug(self, settings, caplog) -> None:
        """
        The client learns that something failed and nothing more.

        Exception text routinely contains connection strings and query
        fragments, so it goes to the logs instead. (README §18, §31)
        """
        settings.DEBUG = False

        with caplog.at_level(logging.ERROR):
            response = handle(RuntimeError("psql://admin:hunter2@db timed out"))

        assert response.status_code == 500
        assert response.data["error"]["code"] == ErrorCode.INTERNAL_ERROR
        assert "hunter2" not in str(response.data)

    def test_logs_the_exception_for_operators(
        self, settings, caplog, monkeypatch
    ) -> None:
        settings.DEBUG = False

        # The `streamsync` logger is configured with propagate=False so records
        # are not emitted twice in production. caplog attaches its handler to
        # the root logger, so propagation is restored for this test only.
        monkeypatch.setattr(logging.getLogger("streamsync"), "propagate", True)

        with caplog.at_level(logging.ERROR, logger="streamsync.api"):
            handle(RuntimeError("boom"))

        assert any(
            "Unhandled exception" in record.getMessage() for record in caplog.records
        )

    def test_defers_to_django_in_debug(self, settings) -> None:
        """Returning None hands the developer the full traceback page."""
        settings.DEBUG = True

        assert handle(RuntimeError("boom")) is None


@pytest.mark.django_db
class TestErrorEnvelopeOverHttp:
    """End-to-end confirmation that the handlers are actually wired up."""

    def test_method_not_allowed_returns_the_envelope(
        self, api_client: APIClient
    ) -> None:
        response = api_client.delete("/api/health/")

        assert response.status_code == 405
        assert response.json()["error"]["code"] == ErrorCode.METHOD_NOT_ALLOWED

    def test_unrouted_api_url_returns_json_not_html(
        self, api_client: APIClient
    ) -> None:
        """
        This path never reaches DRF, so it is handler404 doing the work.

        Without it the frontend receives an HTML page from a request it made
        with Accept: application/json.
        """
        response = api_client.get("/api/does-not-exist/")

        assert response.status_code == 404
        assert response.headers["Content-Type"] == "application/json"
        assert response.json()["error"]["code"] == ErrorCode.NOT_FOUND

    def test_unrouted_non_api_url_still_renders_html(
        self, api_client: APIClient
    ) -> None:
        """The admin and any future server-rendered page keep Django's pages."""
        response = api_client.get("/definitely-not-here/")

        assert response.status_code == 404
        assert "text/html" in response.headers["Content-Type"]
