"""
Rate limiting on the credential endpoints.

Separated from the main auth suite because these tests deliberately turn
throttling on. The global settings keep it off so that ordinary tests do not
depend on execution order or leak cache state into one another. (README §24)
"""

from unittest import mock

import pytest
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from tests.conftest import DEFAULT_TEST_PASSWORD

pytestmark = pytest.mark.django_db

LOGIN_URL = reverse("accounts:login")
REGISTER_URL = reverse("accounts:register")


@pytest.fixture(autouse=True)
def _clear_throttle_state():
    """
    Throttle counters live in the cache, which is process-wide.

    Without clearing, a test that exhausts a limit would make the next one fail
    for reasons that have nothing to do with what it is asserting.
    """
    cache.clear()
    yield
    cache.clear()


def throttled_at(rate: str):
    """
    Re-enable throttling at a rate low enough to trip within a test.

    Patches the throttle class attribute rather than using override_settings:
    DRF binds `SimpleRateThrottle.THROTTLE_RATES` once at import, so overriding
    the REST_FRAMEWORK setting leaves the already-bound rates in place and the
    test silently measures nothing.
    """
    return mock.patch.object(
        SimpleRateThrottle,
        "THROTTLE_RATES",
        {"auth_login": rate, "auth_register": rate, "auth_refresh": rate},
    )


class TestLoginThrottling:
    def test_blocks_repeated_failed_logins(self, user) -> None:
        """
        The defence against online password guessing. Without it an attacker
        can try passwords as fast as the network allows. (README §24)
        """
        with throttled_at("3/min"):
            client = APIClient()
            attempt = {"email": user.email, "password": "wrong-password"}

            statuses = [client.post(LOGIN_URL, attempt).status_code for _ in range(5)]

        assert statuses[:3] == [401, 401, 401]
        assert statuses[3] == 429

    def test_throttled_response_uses_the_standard_envelope(self, user) -> None:
        with throttled_at("1/min"):
            client = APIClient()
            attempt = {"email": user.email, "password": "wrong-password"}

            client.post(LOGIN_URL, attempt)
            response = client.post(LOGIN_URL, attempt)

        assert response.status_code == 429
        assert response.json()["error"]["code"] == "THROTTLED"
        # Lets a well-behaved client back off rather than hammer the endpoint.
        assert "Retry-After" in response.headers

    def test_throttle_applies_to_successful_logins_too(self, user) -> None:
        """
        Counting only failures would let an attacker with one valid account
        keep the endpoint warm while guessing against another.
        """
        with throttled_at("2/min"):
            client = APIClient()
            credentials = {"email": user.email, "password": DEFAULT_TEST_PASSWORD}

            first = client.post(LOGIN_URL, credentials)
            client.post(LOGIN_URL, credentials)
            third = client.post(LOGIN_URL, credentials)

        assert first.status_code == 200
        assert third.status_code == 429


class TestRegistrationThrottling:
    def test_limits_account_creation(self) -> None:
        with throttled_at("2/min"):
            client = APIClient()
            statuses = []
            for index in range(4):
                response = client.post(
                    REGISTER_URL,
                    {
                        "name": f"User {index}",
                        "email": f"user{index}@streamsync.test",
                        "password": DEFAULT_TEST_PASSWORD,
                    },
                )
                statuses.append(response.status_code)

        assert statuses[:2] == [201, 201]
        assert statuses[2] == 429
