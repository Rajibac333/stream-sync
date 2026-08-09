"""
Error codes and the application exception type.

Clients branch on `code`, never on `message`. Codes are stable and
machine-readable; messages are human-facing and may be reworded or localised
without breaking a consumer. (README §18)
"""

from typing import Any

from rest_framework import status
from rest_framework.exceptions import APIException


class ErrorCode:
    """
    The canonical set of error codes returned by the API.

    A plain namespace rather than an enum: these values are serialised as
    strings, compared as strings by the frontend, and gain nothing from being
    wrapped. Later milestones extend this list with domain codes such as
    DOCUMENT_NOT_FOUND or WORKSPACE_ACCESS_DENIED.
    """

    # Transport / framework level, produced by the exception handler.
    VALIDATION_ERROR = "VALIDATION_ERROR"
    AUTHENTICATION_REQUIRED = "AUTHENTICATION_REQUIRED"
    AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    NOT_FOUND = "NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    PARSE_ERROR = "PARSE_ERROR"
    UNSUPPORTED_MEDIA_TYPE = "UNSUPPORTED_MEDIA_TYPE"
    THROTTLED = "THROTTLED"
    CONFLICT = "CONFLICT"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"


class ApplicationError(APIException):
    """
    Base class for errors raised by service-layer code.

    Subclassing DRF's APIException means services can raise domain errors and
    have them rendered by the same handler as framework errors, without views
    translating exceptions into responses by hand. (README §35, §36)
    """

    status_code = status.HTTP_400_BAD_REQUEST
    default_code = ErrorCode.VALIDATION_ERROR
    default_detail = "The request could not be processed."

    def __init__(
        self,
        detail: str | None = None,
        code: str | None = None,
        *,
        extra: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(detail=detail, code=code)
        # Optional structured context (e.g. which field conflicted). Must never
        # contain secrets or internal database detail. (README §18)
        self.extra = extra or {}


class ConflictError(ApplicationError):
    """The request is valid but conflicts with current server state."""

    status_code = status.HTTP_409_CONFLICT
    default_code = ErrorCode.CONFLICT
    default_detail = "The request conflicts with the current state."


class ServiceUnavailableError(ApplicationError):
    """A dependency the request needs is temporarily unreachable."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_code = ErrorCode.SERVICE_UNAVAILABLE
    default_detail = "The service is temporarily unavailable."
