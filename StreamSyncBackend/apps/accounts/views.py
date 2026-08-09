"""
Authentication endpoints.

Each view does the same five things and nothing more: authenticate, validate,
authorize, call a service, return a response. The workflows themselves are in
`services.py`. (README §35)

    POST /api/auth/register/   create an account and sign in
    POST /api/auth/login/      sign in
    POST /api/auth/google/     sign in (or register) with a verified Google identity
    POST /api/auth/refresh/    rotate the token pair from the refresh cookie
    POST /api/auth/logout/     revoke the refresh token and clear the cookie
    GET  /api/auth/me/         the signed-in user
"""

import logging

from drf_spectacular.utils import OpenApiExample, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .cookies import clear_refresh_cookie, read_refresh_cookie, set_refresh_cookie
from .serializers import (
    GoogleLoginSerializer,
    LoginSerializer,
    RegisterSerializer,
    SessionSerializer,
    UserSerializer,
)
from .throttles import AuthEndpointThrottle, RefreshThrottle

logger = logging.getLogger("streamsync.auth")

# Reused by the three endpoints that return a session.
SESSION_RESPONSE = OpenApiResponse(
    response=SessionSerializer,
    description=(
        "Authenticated. The refresh token is set as an httpOnly cookie and is "
        "deliberately absent from this body."
    ),
)

SESSION_EXAMPLE = OpenApiExample(
    "Session",
    value={
        "user": {
            "id": "6f1b7c58-6d3a-4a5e-9e5e-9c0b1f2a3d4e",
            "name": "Raj Kumar",
            "email": "raj@streamsync.app",
            "avatar_url": None,
            "title": None,
            "created_at": "2026-08-03T10:15:00Z",
        },
        "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "expires_at": "2026-08-03T10:30:00Z",
    },
    response_only=True,
)


class BaseAuthView(APIView):
    """
    Shared configuration for the unauthenticated credential endpoints.

    `authentication_classes` is emptied because these endpoints establish a
    session rather than consume one. Leaving JWTAuthentication active would
    make an expired access token in the Authorization header fail the request
    with a 401 before the body was ever read — so a user whose session just
    expired could not log back in without clearing state.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [AuthEndpointThrottle]


def _session_response(
    session: services.Session,
    *,
    status_code: int,
    persistent: bool,
) -> Response:
    """Serialise a session and attach the refresh cookie."""
    payload = SessionSerializer(
        {
            "user": session.user,
            "access": session.access,
            "expires_at": session.expires_at,
        }
    ).data

    response = Response(payload, status=status_code)
    return set_refresh_cookie(response, session.refresh, persistent=persistent)


class RegisterView(BaseAuthView):
    throttle_scope = "auth_register"

    @extend_schema(
        operation_id="auth_register",
        summary="Create an account",
        description=(
            "Creates an account and signs the new user in. Passwords are "
            "checked against Django's configured validators; failures come "
            "back as field errors on `password`."
        ),
        request=RegisterSerializer,
        responses={
            201: SESSION_RESPONSE,
            400: OpenApiResponse(
                description="Validation error, e.g. email already registered."
            ),
            429: OpenApiResponse(description="Too many registration attempts."),
        },
        examples=[SESSION_EXAMPLE],
        tags=["auth"],
    )
    def post(self, request: Request) -> Response:
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        session = services.register_user(**serializer.validated_data)

        # A newly created account is not a "remember me" decision the user has
        # made yet, so the cookie lasts for the browser session only.
        return _session_response(
            session, status_code=status.HTTP_201_CREATED, persistent=False
        )


class LoginView(BaseAuthView):
    throttle_scope = "auth_login"

    @extend_schema(
        operation_id="auth_login",
        summary="Sign in",
        description=(
            "Exchanges email and password for a token pair. Wrong credentials "
            "and unknown accounts return an identical 401, so this endpoint "
            "cannot be used to discover which emails are registered."
        ),
        request=LoginSerializer,
        responses={
            200: SESSION_RESPONSE,
            400: OpenApiResponse(description="Malformed request body."),
            401: OpenApiResponse(description="Incorrect email or password."),
            429: OpenApiResponse(description="Too many sign-in attempts."),
        },
        examples=[SESSION_EXAMPLE],
        tags=["auth"],
    )
    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        session = services.login_user(
            request=request,
            email=serializer.validated_data["email"],
            password=serializer.validated_data["password"],
        )

        return _session_response(
            session,
            status_code=status.HTTP_200_OK,
            persistent=serializer.validated_data["remember_me"],
        )


class GoogleLoginView(BaseAuthView):
    """
    Sign in with a verified Google identity.

    Shares `auth_login`'s throttle scope rather than getting its own: a Google
    credential that fails verification is the same category of failed sign-in
    attempt as a wrong password, and it should cost an attacker the same
    budget.
    """

    throttle_scope = "auth_login"

    @extend_schema(
        operation_id="auth_google",
        summary="Sign in with Google",
        description=(
            "Exchanges a verified Google ID token — the `credential` Google's "
            "Sign In With Google button hands the frontend — for a StreamSync "
            "session. The first sign-in for a given Google identity creates "
            "the account automatically; an existing password account sharing "
            "the same verified email is linked rather than duplicated."
        ),
        request=GoogleLoginSerializer,
        responses={
            200: SESSION_RESPONSE,
            201: SESSION_RESPONSE,
            401: OpenApiResponse(
                description="The Google credential could not be verified."
            ),
            429: OpenApiResponse(description="Too many attempts."),
            503: OpenApiResponse(description="Google sign-in is not configured."),
        },
        examples=[SESSION_EXAMPLE],
        tags=["auth"],
    )
    def post(self, request: Request) -> Response:
        serializer = GoogleLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        session, created = services.authenticate_with_google(
            credential=serializer.validated_data["credential"]
        )

        return _session_response(
            session,
            status_code=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
            persistent=serializer.validated_data["remember_me"],
        )


class RefreshView(BaseAuthView):
    # Keyed on the session rather than the address: refresh fires on every
    # page load, so a per-IP budget signs out everyone behind one NAT.
    throttle_classes = [RefreshThrottle]
    throttle_scope = "auth_refresh"

    @extend_schema(
        operation_id="auth_refresh",
        summary="Refresh the session",
        description=(
            "Reads the refresh token from its httpOnly cookie, revokes it and "
            "issues a new pair. The request body is ignored. Returns the user "
            "as well as the access token so a page reload can restore the "
            "session in one round trip."
        ),
        request=None,
        responses={
            200: SESSION_RESPONSE,
            401: OpenApiResponse(
                description="Missing, expired or already-used refresh token."
            ),
        },
        examples=[SESSION_EXAMPLE],
        tags=["auth"],
    )
    def post(self, request: Request) -> Response:
        session = services.refresh_session(
            raw_refresh_token=read_refresh_cookie(request)
        )

        # Whether the original cookie was persistent is not recoverable from
        # the request, so rotation preserves the token's remaining lifetime by
        # issuing a persistent cookie. The token's own expiry still governs.
        return _session_response(
            session, status_code=status.HTTP_200_OK, persistent=True
        )


class LogoutView(APIView):
    """
    End the session.

    Deliberately AllowAny: logging out must work even when the access token
    has already expired, which is exactly when a user is most likely to click
    "sign out". Authorization is not needed because possession of the refresh
    cookie is what is being revoked.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        operation_id="auth_logout",
        summary="Sign out",
        description=(
            "Blacklists the refresh token and clears its cookie. Idempotent: "
            "returns 204 even when there was no session to end."
        ),
        request=None,
        responses={204: OpenApiResponse(description="Signed out.")},
        tags=["auth"],
    )
    def post(self, request: Request) -> Response:
        services.revoke_refresh_token(raw_refresh_token=read_refresh_cookie(request))

        logger.info("User logged out", extra={"event": "auth.logout"})

        response = Response(status=status.HTTP_204_NO_CONTENT)
        return clear_refresh_cookie(response)


class CurrentUserView(APIView):
    """
    The signed-in user.

    Uses the project-wide default permission (IsAuthenticated), so it is also
    the smallest possible check that JWT authentication is wired up correctly.
    Stated explicitly rather than inherited, because the security of this
    endpoint should be readable without opening the settings module.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="auth_me",
        summary="Current user",
        responses={
            200: UserSerializer,
            401: OpenApiResponse(description="No or invalid access token."),
        },
        tags=["auth"],
    )
    def get(self, request: Request) -> Response:
        return Response(UserSerializer(request.user).data)
