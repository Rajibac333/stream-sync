"""
The single place where an exception becomes an HTTP response.

Every error the API returns has the same shape, so the frontend needs exactly
one branch for failures:

    {
      "error": {
        "code": "VALIDATION_ERROR",
        "message": "The submitted data was invalid.",
        "details": {"email": ["Enter a valid email address."]}
      }
    }

Raw Python exceptions and stack traces never reach a client. (README §18)
"""

import logging
from typing import Any

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import exceptions as drf_exceptions
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from .errors import ApplicationError, ErrorCode

logger = logging.getLogger("streamsync.api")

# DRF exception class -> stable error code. Anything unlisted falls back to the
# status-code mapping below, so a new DRF exception degrades gracefully rather
# than surfacing as an unhelpful "ERROR".
_EXCEPTION_CODES: dict[type[Exception], str] = {
    drf_exceptions.ParseError: ErrorCode.PARSE_ERROR,
    drf_exceptions.AuthenticationFailed: ErrorCode.AUTHENTICATION_FAILED,
    drf_exceptions.NotAuthenticated: ErrorCode.AUTHENTICATION_REQUIRED,
    drf_exceptions.PermissionDenied: ErrorCode.PERMISSION_DENIED,
    drf_exceptions.NotFound: ErrorCode.NOT_FOUND,
    drf_exceptions.MethodNotAllowed: ErrorCode.METHOD_NOT_ALLOWED,
    drf_exceptions.UnsupportedMediaType: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
    drf_exceptions.Throttled: ErrorCode.THROTTLED,
    drf_exceptions.ValidationError: ErrorCode.VALIDATION_ERROR,
}

_STATUS_CODES: dict[int, str] = {
    400: ErrorCode.VALIDATION_ERROR,
    401: ErrorCode.AUTHENTICATION_REQUIRED,
    403: ErrorCode.PERMISSION_DENIED,
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.METHOD_NOT_ALLOWED,
    409: ErrorCode.CONFLICT,
    415: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
    429: ErrorCode.THROTTLED,
    503: ErrorCode.SERVICE_UNAVAILABLE,
}

# Shown instead of the real exception text on a 5xx, which may contain
# connection strings or query fragments.
_INTERNAL_ERROR_MESSAGE = "An unexpected error occurred. Please try again."

_DEFAULT_MESSAGES = {
    ErrorCode.VALIDATION_ERROR: "The submitted data was invalid.",
    ErrorCode.AUTHENTICATION_REQUIRED: "Authentication credentials were not provided.",
    ErrorCode.PERMISSION_DENIED: "You do not have permission to perform this action.",
    ErrorCode.NOT_FOUND: "The requested resource could not be found.",
    ErrorCode.THROTTLED: "Too many requests. Please slow down and try again.",
}


def build_error_response(
    code: str,
    message: str,
    *,
    status_code: int,
    details: Any = None,
) -> Response:
    """Assemble the canonical error body. Used by the handler and by tests."""
    error: dict[str, Any] = {"code": code, "message": message}
    if details:
        error["details"] = details
    return Response({"error": error}, status=status_code)


def _resolve_code(exc: Exception, status_code: int) -> str:
    """Pick the most specific stable code available for this exception."""
    # A service-layer error names its own code and is the most specific signal.
    if isinstance(exc, ApplicationError):
        code = exc.detail.code if hasattr(exc.detail, "code") else None
        if code and code != "error":
            return str(code)
        return str(exc.default_code)

    for exc_type, code in _EXCEPTION_CODES.items():
        if isinstance(exc, exc_type):
            return code

    return _STATUS_CODES.get(status_code, ErrorCode.INTERNAL_ERROR)


def _split_message_and_details(exc: Exception, code: str) -> tuple[str, Any]:
    """
    Separate the human-readable summary from structured field errors.

    Validation errors carry a per-field mapping that belongs in `details`; the
    top-level `message` stays a sentence a user interface can display as-is.
    """
    detail = getattr(exc, "detail", None)

    if isinstance(detail, dict | list):
        return _DEFAULT_MESSAGES.get(code, "The submitted data was invalid."), detail

    if detail is not None:
        return str(detail), None

    return _DEFAULT_MESSAGES.get(code, "The request could not be processed."), None


def api_exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    """
    DRF's DEFAULT_EXCEPTION_HANDLER.

    Django-native exceptions are translated into their DRF equivalents first so
    that a single code path formats every error.
    """
    if isinstance(exc, Http404):
        exc = drf_exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = drf_exceptions.PermissionDenied()
    elif isinstance(exc, DjangoValidationError):
        # Raised by model.full_clean() and custom field validators.
        exc = drf_exceptions.ValidationError(
            exc.message_dict if hasattr(exc, "message_dict") else list(exc.messages)
        )

    response = drf_exception_handler(exc, context)

    if response is None:
        return _handle_unexpected(exc, context)

    code = _resolve_code(exc, response.status_code)
    message, details = _split_message_and_details(exc, code)

    if isinstance(exc, ApplicationError) and exc.extra:
        # Merge into field errors when there are some; otherwise `extra` is the
        # whole of `details`.
        details = {**details, **exc.extra} if isinstance(details, dict) else exc.extra

    error_response = build_error_response(
        code, message, status_code=response.status_code, details=details
    )
    # Preserve headers DRF computed — notably Retry-After on a 429, Allow on a
    # 405 and WWW-Authenticate on a 401. Dropping them breaks well-behaved
    # clients. Content-Type is excluded because the renderer sets it.
    for header, value in response.headers.items():
        if header.lower() != "content-type":
            error_response[header] = value
    return error_response


def _handle_unexpected(exc: Exception, context: dict[str, Any]) -> Response | None:
    """
    Anything DRF does not recognise: a genuine bug, a database outage, and so on.

    Returning None in DEBUG hands the exception back to Django so the developer
    gets the full traceback page. In every other environment the client gets an
    opaque 500 and the detail goes to the logs, where it belongs.
    """
    from django.conf import settings

    view = context.get("view")
    request = context.get("request")

    logger.exception(
        "Unhandled exception in %s",
        view.__class__.__name__ if view else "unknown view",
        extra={
            "view": view.__class__.__name__ if view else None,
            "path": getattr(request, "path", None),
            "method": getattr(request, "method", None),
            "exception_type": type(exc).__name__,
        },
    )

    if settings.DEBUG:
        return None

    return build_error_response(
        ErrorCode.INTERNAL_ERROR,
        _INTERNAL_ERROR_MESSAGE,
        status_code=500,
    )
