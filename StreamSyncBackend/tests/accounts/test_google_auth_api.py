"""
Google Sign-In.

`POST /api/auth/google/` never talks to Google during this suite — the
verification call is patched at its source, `google.oauth2.id_token`, so these
tests assert what the endpoint does with a set of *claims*, the same boundary
`login_user` sits behind `django.contrib.auth.authenticate`.
"""

from unittest import mock

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from google.auth.exceptions import GoogleAuthError as GoogleLibraryError
from rest_framework.test import APIClient

User = get_user_model()

pytestmark = pytest.mark.django_db

GOOGLE_URL = reverse("accounts:google")
COOKIE = settings.REFRESH_COOKIE_NAME
CLIENT_ID = "test-client-id.apps.googleusercontent.com"


def claims(**overrides) -> dict:
    return {
        "sub": "108451234567890123456",
        "email": "maria@streamsync.test",
        "email_verified": True,
        "name": "Maria Alvarez",
        "picture": "https://lh3.googleusercontent.com/a/maria.jpg",
        **overrides,
    }


def verifying(return_value=None, side_effect=None):
    """
    Patches the one call this endpoint makes to Google's library.

    `_verify_google_credential` imports `google.oauth2.id_token` fresh inside
    the function on every call rather than at module load, so the patch target
    is the real library function, not a name inside `services`.
    """
    return mock.patch(
        "google.oauth2.id_token.verify_oauth2_token",
        return_value=return_value,
        side_effect=side_effect,
    )


@pytest.fixture(autouse=True)
def configured():
    with override_settings(GOOGLE_OAUTH_CLIENT_ID=CLIENT_ID):
        yield


class TestFirstSignIn:
    def test_creates_an_account_and_returns_201(self, api_client: APIClient) -> None:
        with verifying(claims()):
            response = api_client.post(GOOGLE_URL, {"credential": "a-valid-jwt"})

        assert response.status_code == 201
        body = response.json()
        assert body["user"]["email"] == "maria@streamsync.test"
        assert body["user"]["name"] == "Maria Alvarez"
        assert "access" in body
        assert "refresh" not in body
        assert COOKIE in response.cookies

    def test_stores_the_google_id_and_avatar(self, api_client: APIClient) -> None:
        with verifying(claims()):
            api_client.post(GOOGLE_URL, {"credential": "a-valid-jwt"})

        user = User.objects.get(email="maria@streamsync.test")
        assert user.google_id == "108451234567890123456"
        assert user.avatar_url == "https://lh3.googleusercontent.com/a/maria.jpg"

    def test_the_account_has_no_usable_password(self, api_client: APIClient) -> None:
        """It can only ever authenticate through Google."""
        with verifying(claims()):
            api_client.post(GOOGLE_URL, {"credential": "a-valid-jwt"})

        user = User.objects.get(email="maria@streamsync.test")
        assert user.has_usable_password() is False

    def test_a_second_call_signs_in_rather_than_creating_again(
        self, api_client: APIClient
    ) -> None:
        with verifying(claims()):
            api_client.post(GOOGLE_URL, {"credential": "first"})

        with verifying(claims()):
            response = api_client.post(GOOGLE_URL, {"credential": "second"})

        assert response.status_code == 200
        assert User.objects.filter(email="maria@streamsync.test").count() == 1


class TestLinkingAnExistingAccount:
    def test_a_password_account_with_the_same_email_is_linked_not_duplicated(
        self, api_client: APIClient, user_factory
    ) -> None:
        """
        Safe specifically because the email came from a verified Google claim,
        not from user input — see the docstring on `authenticate_with_google`.
        """
        existing = user_factory(email="maria@streamsync.test", name="Maria Original")

        with verifying(claims(email="Maria@StreamSync.test")):
            response = api_client.post(GOOGLE_URL, {"credential": "a-valid-jwt"})

        assert response.status_code == 200
        assert User.objects.filter(email__iexact="maria@streamsync.test").count() == 1
        existing.refresh_from_db()
        assert existing.google_id == "108451234567890123456"

    def test_linking_does_not_overwrite_an_avatar_already_set(
        self, api_client: APIClient, user_factory
    ) -> None:
        existing = user_factory(
            email="maria@streamsync.test", avatar_url="https://cdn.example/mine.png"
        )

        with verifying(claims()):
            api_client.post(GOOGLE_URL, {"credential": "a-valid-jwt"})

        existing.refresh_from_db()
        assert existing.avatar_url == "https://cdn.example/mine.png"

    def test_a_deactivated_linked_account_is_refused(
        self, api_client: APIClient, user_factory
    ) -> None:
        user_factory(email="maria@streamsync.test", is_active=False)

        with verifying(claims()):
            response = api_client.post(GOOGLE_URL, {"credential": "a-valid-jwt"})

        assert response.status_code == 401


class TestRejection:
    def test_a_forged_or_expired_token_is_rejected(self, api_client: APIClient) -> None:
        with verifying(side_effect=GoogleLibraryError("bad signature")):
            response = api_client.post(GOOGLE_URL, {"credential": "garbage"})

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "GOOGLE_AUTH_FAILED"
        assert User.objects.count() == 0

    def test_malformed_input_is_rejected_the_same_way(
        self, api_client: APIClient
    ) -> None:
        """Not a JWT at all — verify_oauth2_token raises ValueError for this."""
        with verifying(side_effect=ValueError("Wrong number of segments")):
            response = api_client.post(GOOGLE_URL, {"credential": "not-a-jwt"})

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "GOOGLE_AUTH_FAILED"

    def test_an_unverified_email_is_rejected(self, api_client: APIClient) -> None:
        with verifying(claims(email_verified=False)):
            response = api_client.post(GOOGLE_URL, {"credential": "a-valid-jwt"})

        assert response.status_code == 401
        assert User.objects.count() == 0

    def test_a_token_with_no_email_claim_is_rejected_not_a_500(
        self, api_client: APIClient
    ) -> None:
        """
        Verification succeeding is not the same as the claims being usable.

        `sub` and `email` are ordinarily always present on a token that gets
        this far, but "ordinarily" is not "guaranteed" — and a `KeyError` three
        lines into the user-matching logic is exactly the kind of surprise a
        production identity exchange must not crash on.
        """
        broken = claims()
        del broken["email"]

        with verifying(broken):
            response = api_client.post(GOOGLE_URL, {"credential": "a-valid-jwt"})

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "GOOGLE_AUTH_FAILED"
        assert User.objects.count() == 0

    def test_a_genuinely_unexpected_failure_is_reported_cleanly_not_as_a_500(
        self, api_client: APIClient
    ) -> None:
        """
        The safety net for everything the two tests above don't anticipate.

        Verification succeeds, but something after it — here, simulated by a
        broken database call — blows up. The caller still gets the ordinary
        Google-sign-in-failed response, never a bare 500, and the real cause is
        still on the server logs via `logger.exception`.
        """
        with (
            verifying(claims()),
            mock.patch(
                "apps.accounts.services.User.objects.filter",
                side_effect=RuntimeError("simulated database outage"),
            ),
        ):
            response = api_client.post(GOOGLE_URL, {"credential": "a-valid-jwt"})

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "GOOGLE_AUTH_FAILED"

    def test_a_missing_credential_is_a_validation_error(
        self, api_client: APIClient
    ) -> None:
        response = api_client.post(GOOGLE_URL, {})

        assert response.status_code == 400

    def test_the_error_never_reveals_which_check_failed(
        self, api_client: APIClient
    ) -> None:
        """
        Same reasoning as password login's single 'incorrect' message: a bad
        signature and an unverified email must not be distinguishable from the
        response, or the endpoint becomes an oracle.
        """
        with verifying(side_effect=GoogleLibraryError("bad signature")):
            forged = api_client.post(GOOGLE_URL, {"credential": "x"})

        with verifying(claims(email_verified=False)):
            unverified = api_client.post(GOOGLE_URL, {"credential": "y"})

        assert forged.json()["error"] == unverified.json()["error"]


class TestNotConfigured:
    def test_with_no_client_id_the_endpoint_is_unavailable(
        self, api_client: APIClient
    ) -> None:
        with override_settings(GOOGLE_OAUTH_CLIENT_ID=""):
            response = api_client.post(GOOGLE_URL, {"credential": "anything"})

        assert response.status_code == 503

    def test_google_is_never_called_when_unconfigured(
        self, api_client: APIClient
    ) -> None:
        with verifying(claims()) as mocked:
            with override_settings(GOOGLE_OAUTH_CLIENT_ID=""):
                api_client.post(GOOGLE_URL, {"credential": "anything"})
            assert mocked.called is False


class TestCookieAndThrottleWiring:
    def test_remember_me_controls_cookie_persistence(
        self, api_client: APIClient
    ) -> None:
        with verifying(claims()):
            response = api_client.post(
                GOOGLE_URL, {"credential": "a-valid-jwt", "remember_me": True}
            )

        # A persistent cookie carries an explicit expiry; a session cookie
        # does not. Same assertion style as test_auth_api.py's login coverage.
        assert response.cookies[COOKIE]["expires"] != ""

    def test_shares_the_login_throttle_scope(self, api_client: APIClient) -> None:
        from apps.accounts.views import GoogleLoginView

        assert GoogleLoginView.throttle_scope == "auth_login"
