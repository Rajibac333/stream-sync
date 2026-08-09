"""
Authentication endpoints, end to end.

Asserted through HTTP rather than by calling services directly, because the
things most likely to be wrong live in the wiring: which status code comes
back, what ends up in the body versus a cookie, and whether the cookie carries
its security flags.

The response shape is a contract the frontend already codes against in
`StreamSyncFrontend/src/api/auth.ts`; the tests below pin it.
"""

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from tests.conftest import DEFAULT_TEST_PASSWORD

User = get_user_model()

pytestmark = pytest.mark.django_db

REGISTER_URL = reverse("accounts:register")
LOGIN_URL = reverse("accounts:login")
REFRESH_URL = reverse("accounts:refresh")
LOGOUT_URL = reverse("accounts:logout")
ME_URL = reverse("accounts:me")

COOKIE = settings.REFRESH_COOKIE_NAME


def register_payload(**overrides) -> dict:
    return {
        "name": "Raj Kumar",
        "email": "raj@streamsync.test",
        "password": DEFAULT_TEST_PASSWORD,
        **overrides,
    }


def bearer(client: APIClient, access: str) -> APIClient:
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    return client


class TestRegistration:
    def test_creates_the_account_and_returns_a_session(
        self, api_client: APIClient
    ) -> None:
        response = api_client.post(REGISTER_URL, register_payload())

        assert response.status_code == 201

        body = response.json()
        assert body["access"]
        assert body["expires_at"]
        assert body["user"]["email"] == "raj@streamsync.test"
        assert body["user"]["name"] == "Raj Kumar"

        assert User.objects.filter(email="raj@streamsync.test").exists()

    def test_signs_the_new_user_straight_in(self, api_client: APIClient) -> None:
        """The returned access token must work immediately."""
        access = api_client.post(REGISTER_URL, register_payload()).json()["access"]

        response = bearer(APIClient(), access).get(ME_URL)

        assert response.status_code == 200
        assert response.json()["email"] == "raj@streamsync.test"

    def test_never_returns_the_password_or_refresh_token(
        self, api_client: APIClient
    ) -> None:
        response = api_client.post(REGISTER_URL, register_payload())

        rendered = response.content.decode()
        assert DEFAULT_TEST_PASSWORD not in rendered
        assert "password" not in response.json()
        assert "refresh" not in response.json()

    def test_rejects_a_duplicate_email(self, api_client: APIClient) -> None:
        api_client.post(REGISTER_URL, register_payload())

        response = api_client.post(REGISTER_URL, register_payload(name="Impostor"))

        assert response.status_code == 400
        assert response.json()["error"]["details"]["email"] == [
            "An account with this email already exists."
        ]
        assert User.objects.filter(email="raj@streamsync.test").count() == 1

    def test_rejects_a_duplicate_email_differing_only_by_case(
        self, api_client: APIClient
    ) -> None:
        """
        Must be a 400 field error, not the 500 an IntegrityError would produce
        when the database constraint fires.
        """
        api_client.post(REGISTER_URL, register_payload())

        response = api_client.post(
            REGISTER_URL, register_payload(email="RAJ@streamsync.test")
        )

        assert response.status_code == 400
        assert "email" in response.json()["error"]["details"]
        assert User.objects.count() == 1

    @pytest.mark.parametrize(
        ("password", "reason"),
        [
            ("short1!", "below the 10-character minimum"),
            ("password123", "on the common-password list"),
            ("8473829104", "entirely numeric"),
        ],
    )
    def test_enforces_password_validators(
        self, api_client: APIClient, password: str, reason: str
    ) -> None:
        response = api_client.post(REGISTER_URL, register_payload(password=password))

        assert response.status_code == 400, reason
        assert "password" in response.json()["error"]["details"]
        assert not User.objects.exists()

    def test_rejects_a_password_that_is_the_users_own_email(
        self, api_client: APIClient
    ) -> None:
        """UserAttributeSimilarityValidator needs the email to catch this."""
        response = api_client.post(
            REGISTER_URL, register_payload(password="raj@streamsync.test")
        )

        assert response.status_code == 400
        assert "password" in response.json()["error"]["details"]

    @pytest.mark.parametrize("field", ["name", "email", "password"])
    def test_requires_every_field(self, api_client: APIClient, field: str) -> None:
        payload = register_payload()
        del payload[field]

        response = api_client.post(REGISTER_URL, payload)

        assert response.status_code == 400
        assert field in response.json()["error"]["details"]

    def test_rejects_a_malformed_email(self, api_client: APIClient) -> None:
        response = api_client.post(REGISTER_URL, register_payload(email="not-an-email"))

        assert response.status_code == 400
        assert "email" in response.json()["error"]["details"]

    def test_cannot_self_assign_staff_or_superuser(self, api_client: APIClient) -> None:
        """
        Privilege escalation check. The serializer accepts only three fields,
        so extra keys in the body are ignored rather than written through.
        """
        response = api_client.post(
            REGISTER_URL,
            register_payload(is_staff=True, is_superuser=True),
        )

        assert response.status_code == 201

        user = User.objects.get(email="raj@streamsync.test")
        assert user.is_staff is False
        assert user.is_superuser is False


class TestLogin:
    def test_returns_a_session_for_correct_credentials(
        self, api_client: APIClient, user
    ) -> None:
        response = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )

        assert response.status_code == 200

        body = response.json()
        assert body["access"]
        assert body["user"]["id"] == str(user.id)

    def test_email_is_case_insensitive(self, api_client: APIClient, user) -> None:
        response = api_client.post(
            LOGIN_URL,
            {"email": user.email.upper(), "password": DEFAULT_TEST_PASSWORD},
        )

        assert response.status_code == 200

    def test_records_last_login(self, api_client: APIClient, user) -> None:
        assert user.last_login is None

        api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )

        user.refresh_from_db()
        assert user.last_login is not None

    def test_rejects_an_invalid_password(self, api_client: APIClient, user) -> None:
        response = api_client.post(
            LOGIN_URL, {"email": user.email, "password": "not-the-right-password"}
        )

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "AUTHENTICATION_FAILED"
        assert COOKIE not in response.cookies

    def test_rejects_an_unknown_account(self, api_client: APIClient) -> None:
        response = api_client.post(
            LOGIN_URL,
            {"email": "nobody@streamsync.test", "password": DEFAULT_TEST_PASSWORD},
        )

        assert response.status_code == 401

    def test_does_not_reveal_whether_an_account_exists(
        self, api_client: APIClient, user
    ) -> None:
        """
        Differing responses would turn login into an account-enumeration
        oracle: an attacker could harvest which emails are registered before
        ever guessing a password. (README §25)
        """
        wrong_password = api_client.post(
            LOGIN_URL, {"email": user.email, "password": "wrong-password-entirely"}
        )
        unknown_account = api_client.post(
            LOGIN_URL,
            {"email": "nobody@streamsync.test", "password": "wrong-password-entirely"},
        )

        assert wrong_password.status_code == unknown_account.status_code
        assert wrong_password.json() == unknown_account.json()

    def test_rejects_a_deactivated_account(self, api_client: APIClient, user) -> None:
        user.is_active = False
        user.save(update_fields=["is_active"])

        response = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )

        assert response.status_code == 401

    def test_rejects_a_missing_password(self, api_client: APIClient, user) -> None:
        response = api_client.post(LOGIN_URL, {"email": user.email})

        assert response.status_code == 400
        assert "password" in response.json()["error"]["details"]


class TestRefreshCookie:
    """The cookie is the whole security model for the refresh token."""

    def test_login_sets_the_refresh_cookie(self, api_client: APIClient, user) -> None:
        response = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )

        assert COOKIE in response.cookies

    def test_refresh_token_is_never_in_the_response_body(
        self, api_client: APIClient, user
    ) -> None:
        """A token in the body is readable by any script on the page."""
        response = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )

        refresh_token = response.cookies[COOKIE].value
        assert refresh_token not in response.content.decode()

    def test_cookie_is_httponly_and_path_scoped(
        self, api_client: APIClient, user
    ) -> None:
        response = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )
        cookie = response.cookies[COOKIE]

        assert cookie["httponly"] is True
        assert cookie["path"] == "/api/auth/"
        assert cookie["samesite"] == "Lax"

    def test_remember_me_makes_the_cookie_persistent(
        self, api_client: APIClient, user
    ) -> None:
        response = api_client.post(
            LOGIN_URL,
            {
                "email": user.email,
                "password": DEFAULT_TEST_PASSWORD,
                "remember_me": True,
            },
        )

        assert response.cookies[COOKIE]["max-age"] > 0

    def test_without_remember_me_the_cookie_expires_with_the_browser(
        self, api_client: APIClient, user
    ) -> None:
        response = api_client.post(
            LOGIN_URL,
            {
                "email": user.email,
                "password": DEFAULT_TEST_PASSWORD,
                "remember_me": False,
            },
        )

        # No Max-Age renders as a session cookie.
        assert response.cookies[COOKIE]["max-age"] == ""


class TestTokenRefresh:
    def test_issues_a_new_session_from_the_cookie(
        self, api_client: APIClient, user
    ) -> None:
        api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )

        # The test client carries the cookie automatically, exactly as a
        # browser does with withCredentials: true.
        response = api_client.post(REFRESH_URL)

        assert response.status_code == 200
        assert response.json()["access"]

    def test_returns_the_user_so_a_reload_restores_the_session(
        self, api_client: APIClient, user
    ) -> None:
        """One round trip on page load, per the frontend's getSession()."""
        api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )

        response = api_client.post(REFRESH_URL)

        assert response.json()["user"]["id"] == str(user.id)
        assert response.json()["expires_at"]

    def test_new_access_token_is_usable(self, api_client: APIClient, user) -> None:
        api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )
        access = api_client.post(REFRESH_URL).json()["access"]

        assert bearer(APIClient(), access).get(ME_URL).status_code == 200

    def test_rotates_the_cookie(self, api_client: APIClient, user) -> None:
        login = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )
        original = login.cookies[COOKIE].value

        response = api_client.post(REFRESH_URL)

        assert response.cookies[COOKIE].value != original

    def test_the_old_refresh_token_stops_working(
        self, api_client: APIClient, user
    ) -> None:
        """
        Rotation without blacklisting would leave a captured token replayable
        for its full lifetime.
        """
        login = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )
        original = login.cookies[COOKIE].value

        api_client.post(REFRESH_URL)

        replay = APIClient()
        replay.cookies[COOKIE] = original
        response = replay.post(REFRESH_URL)

        assert response.status_code == 401

    def test_rejects_a_request_with_no_cookie(self, api_client: APIClient) -> None:
        response = api_client.post(REFRESH_URL)

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "AUTHENTICATION_FAILED"

    def test_rejects_a_forged_token(self, api_client: APIClient) -> None:
        api_client.cookies[COOKIE] = "not.a.real.token"

        response = api_client.post(REFRESH_URL)

        assert response.status_code == 401

    def test_ignores_a_refresh_token_supplied_in_the_body(
        self, api_client: APIClient, user
    ) -> None:
        """
        The cookie is the only accepted source. Accepting a body token would
        re-admit the token to JavaScript's reach and undo the httpOnly design.
        """
        login = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )
        token = login.cookies[COOKIE].value

        clean = APIClient()
        response = clean.post(REFRESH_URL, {"refresh": token})

        assert response.status_code == 401

    def test_rejects_an_access_token_used_as_a_refresh_token(
        self, api_client: APIClient, user
    ) -> None:
        """Token type confusion: the access token has a much weaker lifetime."""
        access = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        ).json()["access"]

        clean = APIClient()
        clean.cookies[COOKIE] = access
        response = clean.post(REFRESH_URL)

        assert response.status_code == 401

    def test_deactivated_user_cannot_refresh(self, api_client: APIClient, user) -> None:
        """
        The user is re-read from the database on every refresh, so revoking
        access takes effect within one access-token lifetime rather than one
        refresh-token lifetime.
        """
        api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )

        user.is_active = False
        user.save(update_fields=["is_active"])

        assert api_client.post(REFRESH_URL).status_code == 401


class TestLogout:
    def test_returns_204_and_clears_the_cookie(
        self, api_client: APIClient, user
    ) -> None:
        api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )

        response = api_client.post(LOGOUT_URL)

        assert response.status_code == 204
        assert response.cookies[COOKIE].value == ""

    def test_revokes_the_refresh_token(self, api_client: APIClient, user) -> None:
        """
        Clearing the cookie alone would not be logout: a token captured
        earlier would still mint access tokens.
        """
        login = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )
        token = login.cookies[COOKIE].value

        api_client.post(LOGOUT_URL)

        replay = APIClient()
        replay.cookies[COOKIE] = token
        assert replay.post(REFRESH_URL).status_code == 401

    def test_is_idempotent_without_a_session(self, api_client: APIClient) -> None:
        """A user clicking "sign out" must not see an error."""
        assert api_client.post(LOGOUT_URL).status_code == 204

    def test_works_with_an_expired_access_token(
        self, api_client: APIClient, user
    ) -> None:
        """
        Logout must not require a valid access token — an expired session is
        precisely when someone reaches for "sign out".
        """
        api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )
        api_client.credentials(HTTP_AUTHORIZATION="Bearer expired.garbage.token")

        assert api_client.post(LOGOUT_URL).status_code == 204


class TestCurrentUser:
    def test_returns_the_authenticated_user(self, api_client: APIClient, user) -> None:
        access = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        ).json()["access"]

        response = bearer(APIClient(), access).get(ME_URL)

        assert response.status_code == 200
        assert response.json() == {
            "id": str(user.id),
            "name": user.name,
            "email": user.email,
            "avatar_url": None,
            "title": None,
            "created_at": response.json()["created_at"],
        }

    def test_optional_fields_serialise_as_null_not_empty_string(
        self, api_client: APIClient, user
    ) -> None:
        """The frontend types these as `string | null` and renders initials."""
        body = (
            bearer(
                APIClient(),
                api_client.post(
                    LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
                ).json()["access"],
            )
            .get(ME_URL)
            .json()
        )

        assert body["avatar_url"] is None
        assert body["title"] is None

    def test_populated_optional_fields_are_returned(
        self, api_client: APIClient, user
    ) -> None:
        user.avatar_url = "https://cdn.streamsync.test/a.png"
        user.title = "Frontend Engineer"
        user.save(update_fields=["avatar_url", "title"])

        access = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        ).json()["access"]
        body = bearer(APIClient(), access).get(ME_URL).json()

        assert body["avatar_url"] == "https://cdn.streamsync.test/a.png"
        assert body["title"] == "Frontend Engineer"

    def test_never_exposes_the_password_hash(self, api_client: APIClient, user) -> None:
        access = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        ).json()["access"]

        body = bearer(APIClient(), access).get(ME_URL).json()

        assert "password" not in body
        assert "is_staff" not in body
        assert "is_superuser" not in body


class TestUnauthorizedAccess:
    def test_rejects_a_request_with_no_token(self, api_client: APIClient) -> None:
        response = api_client.get(ME_URL)

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "AUTHENTICATION_REQUIRED"

    def test_rejects_a_garbage_token(self, api_client: APIClient) -> None:
        response = bearer(api_client, "not-a-jwt").get(ME_URL)

        assert response.status_code == 401

    def test_rejects_a_token_signed_with_the_wrong_key(
        self, api_client: APIClient, user
    ) -> None:
        """A forged token must not be accepted just because it parses."""
        import jwt

        forged = jwt.encode(
            {"user_id": str(user.id), "token_type": "access", "jti": "x"},
            # At least 32 bytes, or PyJWT refuses to sign at all and the test
            # would pass without ever reaching signature verification.
            "an-attacker-chosen-signing-key-long-enough-for-hs256",
            algorithm="HS256",
        )

        assert bearer(api_client, forged).get(ME_URL).status_code == 401

    def test_rejects_an_expired_access_token(self, api_client: APIClient, user) -> None:
        from datetime import timedelta

        from rest_framework_simplejwt.tokens import AccessToken

        token = AccessToken.for_user(user)
        token.set_exp(
            from_time=token.current_time - timedelta(hours=2),
            lifetime=timedelta(minutes=1),
        )

        response = bearer(api_client, str(token)).get(ME_URL)

        assert response.status_code == 401

    def test_rejects_a_refresh_token_used_as_a_bearer_token(
        self, api_client: APIClient, user
    ) -> None:
        """Token type confusion in the other direction."""
        login = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        )
        refresh = login.cookies[COOKIE].value

        assert bearer(APIClient(), refresh).get(ME_URL).status_code == 401

    def test_deactivated_user_cannot_use_an_existing_access_token(
        self, api_client: APIClient, user
    ) -> None:
        access = api_client.post(
            LOGIN_URL, {"email": user.email, "password": DEFAULT_TEST_PASSWORD}
        ).json()["access"]

        user.is_active = False
        user.save(update_fields=["is_active"])

        assert bearer(APIClient(), access).get(ME_URL).status_code == 401

    def test_error_body_uses_the_standard_envelope(self, api_client: APIClient) -> None:
        """Consistent with every other error the API returns. (README §18)"""
        body = api_client.get(ME_URL).json()

        assert set(body) == {"error"}
        assert set(body["error"]) >= {"code", "message"}
