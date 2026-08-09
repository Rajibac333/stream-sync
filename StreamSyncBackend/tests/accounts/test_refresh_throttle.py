"""
The refresh endpoint's rate limit is per session, not per address.

Refresh is unlike login: it needs a valid cookie, and it fires on every page
load. A per-IP budget therefore throttles a shared office connection rather than
an attacker — the tenth person to open the app is signed out while nobody has
done anything wrong.
"""

from typing import Any
from unittest import mock

import pytest
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

pytestmark = pytest.mark.django_db

REFRESH_URL = reverse("accounts:refresh")
LOGIN_URL = reverse("accounts:login")


# The suite disables throttling globally; these tests re-enable one scope at a
# rate low enough to trip. `override_settings` cannot do it — the rate is bound
# to the class at import.
def throttled_at(rate: str):
    return mock.patch.object(
        SimpleRateThrottle, "THROTTLE_RATES", {"auth_refresh": rate, "auth_login": rate}
    )


@pytest.fixture(autouse=True)
def clear_throttle_history() -> Any:
    cache.clear()
    yield
    cache.clear()


def sign_in(user: Any, password: str) -> APIClient:
    """A client holding a real refresh cookie for `user`."""
    client = APIClient()
    response = client.post(
        LOGIN_URL, {"email": user.email, "password": password}, format="json"
    )
    assert response.status_code == 200
    return client


class TestRefreshThrottle:
    def test_two_sessions_do_not_share_a_budget(
        self, user_factory: Any, api_client: Any
    ) -> None:
        """
        The property that matters.

        Both clients come from the same address — as everyone behind one office
        NAT does — so a per-IP key would let the first exhaust the second's
        budget.
        """
        from tests.conftest import DEFAULT_TEST_PASSWORD

        first = sign_in(user_factory(name="First"), DEFAULT_TEST_PASSWORD)
        second = sign_in(user_factory(name="Second"), DEFAULT_TEST_PASSWORD)

        with throttled_at("1/min"):
            assert first.post(REFRESH_URL).status_code == 200
            # First session is now out of budget...
            assert first.post(REFRESH_URL).status_code == 429
            # ...and the second is unaffected.
            assert second.post(REFRESH_URL).status_code == 200

    def test_one_session_is_still_capped(self, user_factory: Any) -> None:
        """Per-session must not mean unlimited."""
        from tests.conftest import DEFAULT_TEST_PASSWORD

        client = sign_in(user_factory(name="Solo"), DEFAULT_TEST_PASSWORD)

        with throttled_at("1/min"):
            assert client.post(REFRESH_URL).status_code == 200
            assert client.post(REFRESH_URL).status_code == 429

    def test_a_caller_with_no_cookie_is_throttled_by_address(
        self, api_client: Any
    ) -> None:
        """
        The only case an attacker can reach.

        With no cookie there is no session to key on, so the limit falls back to
        the client address — which is what bounds someone probing the endpoint
        without a credential.
        """
        with throttled_at("1/min"):
            first = api_client.post(REFRESH_URL)
            second = api_client.post(REFRESH_URL)

        # 401 for the missing cookie the first time, 429 once the address is out
        # of budget — the point being that the second request was *counted*.
        assert first.status_code == 401
        assert second.status_code == 429

    def test_the_budget_survives_token_rotation(self, user_factory: Any) -> None:
        """
        The reason the key is the user and not the cookie.

        Every refresh issues a *new* refresh token, so a cookie-keyed limit
        would land on a fresh key each time and never bind — a rate limit that
        silently does nothing, which is worse than none at all.
        """
        from apps.accounts.throttles import RefreshThrottle
        from tests.conftest import DEFAULT_TEST_PASSWORD

        client = sign_in(user_factory(name="Rotating"), DEFAULT_TEST_PASSWORD)

        throttle = RefreshThrottle()
        throttle.scope = "auth_refresh"

        def key_now() -> str:
            request = mock.Mock()
            request.COOKIES = {
                "streamsync_refresh": client.cookies["streamsync_refresh"].value
            }
            request.META = {"REMOTE_ADDR": "127.0.0.1"}
            return throttle.get_cache_key(request, view=None)

        before = key_now()
        assert client.post(REFRESH_URL).status_code == 200
        after = key_now()

        # The cookie changed; the budget it spends did not.
        assert before == after

    def test_a_forged_token_cannot_choose_a_budget(self, api_client: Any) -> None:
        """Verification, not decoding: an unsigned token keys on the address."""
        from apps.accounts.throttles import RefreshThrottle

        throttle = RefreshThrottle()
        throttle.scope = "auth_refresh"

        request = mock.Mock()
        request.COOKIES = {"streamsync_refresh": "not.a.token"}
        request.META = {"REMOTE_ADDR": "203.0.113.7"}

        assert "203.0.113.7" in throttle.get_cache_key(request, view=None)
