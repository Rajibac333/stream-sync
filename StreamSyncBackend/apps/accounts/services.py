"""
Authentication workflows.

Views authenticate, validate, authorize, call one of these, and return a
response. Everything that is more than one step — creating an account,
verifying credentials, minting and rotating a token pair, revoking one —
happens here, so the same logic is reachable from a future WebSocket handler
or management command without going through HTTP. (README §35, §36)
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import AbstractBaseUser
from django.db import transaction
from django.db.models.functions import Lower
from django.http import HttpRequest
from django.utils import timezone
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from common.exceptions import ApplicationError, ErrorCode

logger = logging.getLogger("streamsync.auth")

User = get_user_model()


class InvalidCredentialsError(ApplicationError):
    """
    Wrong email, wrong password, or a deactivated account.

    One error for all three on purpose. Distinguishing "no such account" from
    "wrong password" turns the login form into an oracle for discovering which
    email addresses are registered. (README §25)
    """

    status_code = 401
    default_code = ErrorCode.AUTHENTICATION_FAILED
    default_detail = "The email or password you entered is incorrect."


class InvalidRefreshTokenError(ApplicationError):
    """The refresh token is missing, malformed, expired or already revoked."""

    status_code = 401
    default_code = ErrorCode.AUTHENTICATION_FAILED
    default_detail = "Your session has expired. Please sign in again."


class GoogleAuthError(ApplicationError):
    """
    A Google credential failed verification, or asserted an unverified email.

    One error for every failure mode, matching `InvalidCredentialsError`'s
    reasoning: an expired token, a forged signature and an audience mismatch
    all get the same response, because the correct next step is identical in
    every case — try signing in again — and distinguishing them would only
    hand an attacker more detail about which part of a forged attempt failed.
    """

    status_code = 401
    default_code = "GOOGLE_AUTH_FAILED"
    default_detail = "We couldn't verify that Google sign-in. Please try again."


class GoogleNotConfiguredError(ApplicationError):
    """Google sign-in was attempted but GOOGLE_OAUTH_CLIENT_ID is unset."""

    status_code = 503
    default_code = ErrorCode.SERVICE_UNAVAILABLE
    default_detail = "Google sign-in is not available right now."


@dataclass(frozen=True)
class Session:
    """
    The outcome of authenticating.

    `refresh` is carried separately from the serialised payload because it
    leaves the server as a cookie, never in the response body — see
    `SessionSerializer` and `cookies.py`.
    """

    user: AbstractBaseUser
    access: str
    refresh: str
    expires_at: datetime


def _build_session(user: AbstractBaseUser) -> Session:
    """Mint a fresh token pair for an already-authenticated user."""
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token

    # Read the expiry from the token itself rather than recomputing
    # now + ACCESS_TOKEN_LIFETIME. The frontend refreshes proactively against
    # this value, so it has to be the moment the token actually stops working.
    expires_at = datetime.fromtimestamp(access["exp"], tz=UTC)

    return Session(
        user=user,
        access=str(access),
        refresh=str(refresh),
        expires_at=expires_at,
    )


@transaction.atomic
def register_user(*, name: str, email: str, password: str) -> Session:
    """
    Create an account and sign the new user straight in.

    Atomic because the frontend treats registration as one step: an account
    that exists but produced no session would strand the user on a signup form
    that now reports their email as taken. (README §21)
    """
    user = User.objects.create_user(name=name, email=email, password=password)

    logger.info(
        "User registered",
        extra={"user_id": str(user.id), "event": "auth.register"},
    )

    return _build_session(user)


def login_user(*, request: HttpRequest | None, email: str, password: str) -> Session:
    """
    Verify credentials and start a session.

    Delegates to django.contrib.auth.authenticate so the configured backend
    handles password hashing and the inactive-user check. It also runs the
    hasher when no account matches, which keeps a nonexistent email from being
    detectably faster to reject than a wrong password.
    """
    user = authenticate(request=request, email=email, password=password)

    if user is None:
        # The email is logged (it is the account identifier and is needed to
        # investigate an attack); the password never is. (README §31)
        logger.warning(
            "Failed login attempt",
            extra={"email": email, "event": "auth.login.failed"},
        )
        raise InvalidCredentialsError

    # Powers "last active" in the admin and, later, member lists.
    user.last_login = timezone.now()
    user.save(update_fields=["last_login", "updated_at"])

    logger.info(
        "User logged in",
        extra={"user_id": str(user.id), "event": "auth.login"},
    )

    return _build_session(user)


def _verify_google_credential(credential: str) -> dict[str, Any]:
    """
    Verify a Google ID token and return its claims.

    Verification — not decoding — is the entire security property this feature
    has. `verify_oauth2_token` checks the cryptographic signature against
    Google's published public keys, the expiry, the issuer, and that `aud`
    matches our own client id, so a token minted for a *different* application
    (or simply invented) is rejected here rather than trusted.

    Imported inside the function, matching the pattern in
    `apps/ai/providers/__init__.py`: a deployment that never enables Google
    sign-in should not need the library importable, and the settings module
    that reads `GOOGLE_OAUTH_CLIENT_ID` must not import app code at load time.
    """
    from django.conf import settings
    from google.auth.exceptions import GoogleAuthError as GoogleLibraryError
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    if not settings.GOOGLE_OAUTH_CLIENT_ID:
        raise GoogleNotConfiguredError

    try:
        claims: dict[str, Any] = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            audience=settings.GOOGLE_OAUTH_CLIENT_ID,
        )
    except (GoogleLibraryError, ValueError) as exc:
        # ValueError covers malformed input (not a JWT at all); GoogleAuthError
        # covers a bad signature, expiry, issuer or audience. Neither detail is
        # something an unauthenticated caller should learn — see GoogleAuthError.
        logger.info(
            "Google credential rejected",
            extra={"event": "auth.google.rejected", "reason": type(exc).__name__},
        )
        raise GoogleAuthError from exc

    if not claims.get("email_verified"):
        # Google will issue an ID token for an address it has not itself
        # verified (e.g. a newly added, unconfirmed alias). Trusting it here
        # would let someone sign in as an email they do not actually control —
        # the exact thing "verified" is supposed to rule out.
        raise GoogleAuthError

    return claims


@transaction.atomic
def authenticate_with_google(*, credential: str) -> tuple[Session, bool]:
    """
    Sign in — or transparently register — with a verified Google identity.

    Returns `(session, created)` so the view can report 201 on a first sign-in
    and 200 on every one after, the same distinction `RegisterView` and
    `LoginView` make separately here in one endpoint.

    MATCHING ORDER

    `google_id` first, because it is the stable identifier Google guarantees
    never to reuse or reassign. Email second, so a person who registered with
    a password and later clicks "Continue with Google" lands on the *same*
    account instead of a confusing duplicate — and this is one of the few
    places in the codebase where matching an incoming email against an
    existing account is safe, specifically because the address just came from
    a claim Google itself verified, not from user-supplied input.

    An account created this way gets `password=None` — an intentionally
    unusable hash (see `UserManager._create_user`), not an empty or predictable
    one. It can only ever authenticate through Google, which is the correct
    state rather than a password field waiting to be exploited through a reset
    flow that was never offered to this user.

    UNEXPECTED FAILURES ARE NOT ALLOWED TO SURFACE AS A 500

    Everything below a successful `_verify_google_credential` touches the
    database and is expected to succeed — but "expected" is not "guaranteed",
    and a third-party identity exchange is exactly the boundary where a raw
    500 is the wrong failure mode: it leaks a stack trace under `DEBUG=True`
    and an opaque server error to a real user mid-sign-in otherwise. Anything
    unanticipated here is logged with its full traceback, so it stays
    diagnosable from the server side, and reported to the caller as the same
    neutral `GoogleAuthError` a bad token gets rather than propagating raw.
    """
    claims = _verify_google_credential(credential)

    # Indexed rather than trusted positionally: `sub` and `email` are always
    # present on a token that reaches this point *in the ordinary case*, but
    # "ordinary case" is not a guarantee worth crashing on, and a clear
    # rejection here is far more diagnosable than a KeyError three lines later.
    google_id = claims.get("sub")
    raw_email = claims.get("email")
    if not google_id or not raw_email:
        logger.error(
            "Google credential verified but was missing required claims",
            extra={
                "event": "auth.google.missing_claims",
                "has_sub": bool(google_id),
                "has_email": bool(raw_email),
            },
        )
        raise GoogleAuthError

    email = User.objects.normalize_email(raw_email).strip()
    name = (claims.get("name") or email.split("@")[0]).strip()
    picture = claims.get("picture") or ""

    try:
        user = User.objects.filter(google_id=google_id).first()

        if user is None:
            user = (
                User.objects.annotate(email_lower=Lower("email"))
                .filter(email_lower=email.lower())
                .first()
            )

        created = user is None
        if created:
            user = User.objects.create_user(email=email, name=name, password=None)

        update_fields: list[str] = []
        if user.google_id != google_id:
            user.google_id = google_id
            update_fields.append("google_id")
        # Only fills a gap — never overwrites an avatar the person chose themselves.
        if not user.avatar_url and picture:
            user.avatar_url = picture
            update_fields.append("avatar_url")
        if update_fields:
            user.save(update_fields=[*update_fields, "updated_at"])

        if not user.is_active:
            # Same neutral outcome a deactivated account gets from password
            # login — see login_user. A linked Google identity is not a bypass.
            raise InvalidCredentialsError

        user.last_login = timezone.now()
        user.save(update_fields=["last_login", "updated_at"])
    except (InvalidCredentialsError, GoogleAuthError):
        raise
    except Exception:
        logger.exception(
            "Unexpected failure completing Google sign-in",
            extra={"event": "auth.google.unexpected_error"},
        )
        raise GoogleAuthError from None

    logger.info(
        "User authenticated with Google"
        if not created
        else "User registered via Google",
        extra={
            "user_id": str(user.id),
            # Not `created`: LogRecord already reserves that attribute name for
            # its own creation timestamp, and passing it in `extra` raises.
            "account_created": created,
            "event": "auth.google.register" if created else "auth.google.login",
        },
    )

    return _build_session(user), created


def refresh_session(*, raw_refresh_token: str | None) -> Session:
    """
    Exchange a refresh token for a new pair.

    Rotation is on: the presented token is blacklisted and a new one issued, so
    a captured refresh token is usable at most once. The full user is returned
    alongside the new access token so the frontend can restore a session on
    page load in a single round trip.
    """
    if not raw_refresh_token:
        raise InvalidRefreshTokenError

    try:
        token = RefreshToken(raw_refresh_token)
    except TokenError as exc:
        # Covers expired, malformed, wrong-signature and already-blacklisted
        # tokens. They are all "sign in again" to the client, and the specific
        # reason is not something an unauthenticated caller should learn.
        logger.info(
            "Refresh token rejected",
            extra={"event": "auth.refresh.rejected", "reason": type(exc).__name__},
        )
        raise InvalidRefreshTokenError from exc

    user = _user_from_token(token)

    # Revoke the presented token before issuing its replacement, so a crash
    # between the two leaves the old token dead rather than both alive.
    token.blacklist()

    logger.info(
        "Session refreshed",
        extra={"user_id": str(user.id), "event": "auth.refresh"},
    )

    return _build_session(user)


def revoke_refresh_token(*, raw_refresh_token: str | None) -> None:
    """
    End a session at logout.

    Never raises. A user who clicked "sign out" must end up signed out even if
    their token was already expired or revoked — reporting an error would be
    both useless and alarming. The cookie is cleared by the view regardless.
    """
    if not raw_refresh_token:
        return

    try:
        RefreshToken(raw_refresh_token).blacklist()
    except TokenError:
        # Already invalid, which is the state logout is trying to reach.
        return


def _user_from_token(token: RefreshToken) -> AbstractBaseUser:
    """
    Resolve the token's subject.

    The user is loaded fresh from the database on every refresh rather than
    trusted from the token's claims, so an account deactivated moments ago
    cannot keep minting access tokens for the rest of the refresh window.
    (README §16)
    """
    from django.conf import settings

    claim: str = settings.SIMPLE_JWT["USER_ID_CLAIM"]
    field: str = settings.SIMPLE_JWT["USER_ID_FIELD"]

    user_id: Any = token.payload.get(claim)
    if user_id is None:
        raise InvalidRefreshTokenError

    try:
        user = User.objects.get(**{field: user_id})
    except (User.DoesNotExist, ValueError, TypeError) as exc:
        # ValueError/TypeError cover a malformed UUID in a forged token.
        raise InvalidRefreshTokenError from exc

    if not user.is_active:
        raise InvalidRefreshTokenError

    return user
