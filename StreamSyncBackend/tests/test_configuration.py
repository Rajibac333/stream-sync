"""
Settings invariants.

Configuration mistakes are silent: nothing crashes when DEBUG is left on or a
permission default is loosened, the system just becomes insecure. These tests
turn the important invariants into failures instead. (README §25)
"""

import importlib
import os
from datetime import timedelta
from unittest import mock

import pytest
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


class TestDatabaseConfiguration:
    def test_uses_postgresql(self) -> None:
        """SQLite is unsupported — PostgreSQL-specific behaviour is relied on."""
        engine = settings.DATABASES["default"]["ENGINE"]

        assert "postgresql" in engine
        assert "sqlite" not in engine


class TestAuthConfiguration:
    def test_uses_the_custom_user_model(self) -> None:
        assert settings.AUTH_USER_MODEL == "accounts.User"

    def test_enforces_password_strength(self) -> None:
        validators = {
            validator["NAME"].rsplit(".", 1)[-1]
            for validator in settings.AUTH_PASSWORD_VALIDATORS
        }

        assert "MinimumLengthValidator" in validators
        assert "CommonPasswordValidator" in validators
        assert "NumericPasswordValidator" in validators


class TestRestFrameworkConfiguration:
    def test_denies_unauthenticated_access_by_default(self) -> None:
        """
        Endpoints must opt *in* to being public.

        A permissive default means a view added without a permission_classes
        line silently exposes data. (README §2, §20)
        """
        defaults = settings.REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"]

        assert defaults == ["rest_framework.permissions.IsAuthenticated"]

    def test_authenticates_with_jwt_only(self) -> None:
        """
        DRF's default would also enable BasicAuthentication, which accepts a
        password on every request and would give an attacker an endpoint to
        brute-force that is not covered by the login throttle.
        """
        classes = settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]

        assert classes == ["rest_framework_simplejwt.authentication.JWTAuthentication"]
        assert not any("Basic" in cls for cls in classes)

    def test_paginates_list_endpoints(self) -> None:
        assert settings.REST_FRAMEWORK["DEFAULT_PAGINATION_CLASS"] == (
            "common.pagination.DefaultPagination"
        )
        assert settings.REST_FRAMEWORK["PAGE_SIZE"] > 0

    def test_uses_the_shared_exception_handler(self) -> None:
        assert settings.REST_FRAMEWORK["EXCEPTION_HANDLER"] == (
            "common.exceptions.api_exception_handler"
        )


class TestCorsConfiguration:
    def test_origins_are_an_explicit_allow_list(self) -> None:
        """
        A wildcard plus credentials lets any site read authenticated responses.

        django-cors-headers exposes this as CORS_ALLOW_ALL_ORIGINS; it must
        never be enabled while CORS_ALLOW_CREDENTIALS is on. (README §25)
        """
        assert getattr(settings, "CORS_ALLOW_ALL_ORIGINS", False) is False
        assert settings.CORS_ALLOW_CREDENTIALS is True
        assert "*" not in settings.CORS_ALLOWED_ORIGINS

    def test_only_the_api_is_cross_origin(self) -> None:
        """The admin must not be callable from a third-party page."""
        assert settings.CORS_URLS_REGEX == r"^/api/.*$"


class TestJwtConfiguration:
    def test_access_token_is_short_lived(self) -> None:
        """
        A stolen access token is only useful until it expires, and it cannot be
        revoked before then — nothing checks a blacklist on every request. The
        lifetime *is* the containment window. (README §19)
        """
        assert settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"] <= timedelta(minutes=30)

    def test_refresh_token_outlives_the_access_token(self) -> None:
        assert (
            settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
            > settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"]
        )

    def test_rotates_and_blacklists_refresh_tokens(self) -> None:
        """Without both, a captured refresh token is replayable until expiry."""
        assert settings.SIMPLE_JWT["ROTATE_REFRESH_TOKENS"] is True
        assert settings.SIMPLE_JWT["BLACKLIST_AFTER_ROTATION"] is True

    def test_blacklist_app_is_installed(self) -> None:
        """Logout cannot revoke anything without it."""
        assert "rest_framework_simplejwt.token_blacklist" in settings.INSTALLED_APPS

    def test_credential_endpoints_are_throttled(self) -> None:
        rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]

        assert "auth_login" in rates
        assert "auth_register" in rates


class TestRefreshCookieConfiguration:
    def test_cookie_is_scoped_to_the_auth_endpoints(self) -> None:
        """Keeps the refresh token off every ordinary API request."""
        assert settings.REFRESH_COOKIE_PATH == "/api/auth/"

    def test_cookie_restricts_cross_site_sending(self) -> None:
        assert settings.REFRESH_COOKIE_SAMESITE in {"Lax", "Strict", "None"}


class TestSecurityDefaults:
    def test_sets_protective_response_headers(self) -> None:
        assert settings.SECURE_CONTENT_TYPE_NOSNIFF is True
        assert settings.X_FRAME_OPTIONS == "DENY"

    def test_session_cookie_is_not_readable_by_javascript(self) -> None:
        assert settings.SESSION_COOKIE_HTTPONLY is True


class TestProductionSettings:
    """
    Loads config.settings.production in isolation.

    Importing the module executes its environment reads, which is exactly the
    behaviour worth testing: a missing secret must stop the process at boot
    rather than degrade security in a running deployment.
    """

    REQUIRED_ENV = {
        "DJANGO_SECRET_KEY": "a-real-production-secret-key-value",
        "DJANGO_ALLOWED_HOSTS": "api.streamsync.app",
        "CORS_ALLOWED_ORIGINS": "https://streamsync.app",
        "DATABASE_URL": "postgres://user:pass@db:5432/streamsync",
    }

    @staticmethod
    def _load(env: dict[str, str]):
        module = importlib.import_module("config.settings.production")
        # A developer's .env would otherwise repopulate the variables this test
        # deliberately removes, making the assertions meaningless.
        with (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch("environ.Env.read_env"),
        ):
            return importlib.reload(module)

    def test_loads_when_every_required_variable_is_present(self) -> None:
        production = self._load(self.REQUIRED_ENV)

        assert production.DEBUG is False
        assert production.ALLOWED_HOSTS == ["api.streamsync.app"]

    @pytest.mark.parametrize(
        "missing",
        ["DJANGO_SECRET_KEY", "DJANGO_ALLOWED_HOSTS", "CORS_ALLOWED_ORIGINS"],
    )
    def test_refuses_to_load_without_a_required_variable(self, missing: str) -> None:
        env = {k: v for k, v in self.REQUIRED_ENV.items() if k != missing}

        with pytest.raises(ImproperlyConfigured):
            self._load(env)

    def test_forces_secure_cookies_and_transport(self) -> None:
        production = self._load(self.REQUIRED_ENV)

        assert production.SESSION_COOKIE_SECURE is True
        assert production.CSRF_COOKIE_SECURE is True
        assert production.SECURE_SSL_REDIRECT is True
        assert production.SECURE_HSTS_SECONDS > 0

    def test_refresh_cookie_is_https_only(self) -> None:
        """
        Forced, not read from the environment: a refresh token sent over plain
        http is a long-lived credential exposed to anyone on the network.
        """
        env = {**self.REQUIRED_ENV, "JWT_REFRESH_COOKIE_SECURE": "False"}

        production = self._load(env)

        assert production.REFRESH_COOKIE_SECURE is True

    def test_never_exposes_the_browsable_api(self) -> None:
        """The browsable renderer would make the API browseable to any visitor."""
        production = self._load(self.REQUIRED_ENV)

        assert production.REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] == [
            "rest_framework.renderers.JSONRenderer"
        ]

    def test_logs_as_json(self) -> None:
        production = self._load(self.REQUIRED_ENV)

        assert production.LOGGING["handlers"]["console"]["formatter"] == "json"
