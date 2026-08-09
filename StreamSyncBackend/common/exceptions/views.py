"""
Django-level error views.

DRF's exception handler only runs once a request has reached a DRF view. A URL
matching no route at all, or a crash in middleware, never gets that far and
would otherwise return Django's HTML error page — to a client that asked for
JSON and has no way to parse it.

These handlers close that gap for /api/ while leaving the admin's HTML pages
alone. (README §18)
"""

from django.http import HttpRequest, HttpResponse, JsonResponse
from django.views import defaults

from .errors import ErrorCode

API_PREFIX = "/api/"


def _wants_api_error(request: HttpRequest) -> bool:
    return request.path.startswith(API_PREFIX)


def _envelope(code: str, message: str, status: int) -> JsonResponse:
    return JsonResponse({"error": {"code": code, "message": message}}, status=status)


def not_found(request: HttpRequest, exception: Exception) -> HttpResponse:
    """Wired as handler404 in config/urls.py."""
    if _wants_api_error(request):
        return _envelope(
            ErrorCode.NOT_FOUND,
            "The requested resource could not be found.",
            404,
        )
    return defaults.page_not_found(request, exception)


def server_error(request: HttpRequest) -> HttpResponse:
    """
    Wired as handler500.

    Deliberately says nothing about the failure: this path is reached when
    something outside a view broke, and the exception text is already in the
    logs where operators can see it. (README §18, §31)
    """
    if _wants_api_error(request):
        return _envelope(
            ErrorCode.INTERNAL_ERROR,
            "An unexpected error occurred. Please try again.",
            500,
        )
    return defaults.server_error(request)


def permission_denied(request: HttpRequest, exception: Exception) -> HttpResponse:
    """Wired as handler403."""
    if _wants_api_error(request):
        return _envelope(
            ErrorCode.PERMISSION_DENIED,
            "You do not have permission to perform this action.",
            403,
        )
    return defaults.permission_denied(request, exception)


def bad_request(request: HttpRequest, exception: Exception) -> HttpResponse:
    """Wired as handler400. Also covers a rejected Host header."""
    if _wants_api_error(request):
        return _envelope(ErrorCode.VALIDATION_ERROR, "The request was invalid.", 400)
    return defaults.bad_request(request, exception)
