"""
CORS behaviour.

The browser is the thing enforcing these headers, so a misconfiguration here
either breaks the frontend entirely or quietly opens the API to every site on
the internet. (README §25)
"""

import pytest
from rest_framework.test import APIClient

ALLOWED_ORIGIN = "http://localhost:5173"
FOREIGN_ORIGIN = "https://evil.example.com"

pytestmark = pytest.mark.django_db


class TestCorsHeaders:
    def test_allows_the_configured_frontend_origin(self, api_client: APIClient) -> None:
        response = api_client.get("/api/health/", headers={"origin": ALLOWED_ORIGIN})

        assert response.headers["Access-Control-Allow-Origin"] == ALLOWED_ORIGIN

    def test_permits_credentialed_requests(self, api_client: APIClient) -> None:
        """Required for the httpOnly refresh cookie the frontend relies on."""
        response = api_client.get("/api/health/", headers={"origin": ALLOWED_ORIGIN})

        assert response.headers["Access-Control-Allow-Credentials"] == "true"

    def test_does_not_allow_an_unlisted_origin(self, api_client: APIClient) -> None:
        """
        The header is absent, so the browser blocks the response.

        The request itself still executes — CORS is not authorisation. Real
        access control is the permission layer. (README §20)
        """
        response = api_client.get("/api/health/", headers={"origin": FOREIGN_ORIGIN})

        assert "Access-Control-Allow-Origin" not in response.headers

    def test_answers_the_preflight_request(self, api_client: APIClient) -> None:
        response = api_client.options(
            "/api/health/",
            headers={
                "origin": ALLOWED_ORIGIN,
                "access-control-request-method": "GET",
            },
        )

        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == ALLOWED_ORIGIN

    def test_does_not_apply_cors_to_the_admin(self, api_client: APIClient) -> None:
        """CORS_URLS_REGEX confines cross-origin access to /api/."""
        response = api_client.get("/admin/login/", headers={"origin": ALLOWED_ORIGIN})

        assert "Access-Control-Allow-Origin" not in response.headers
