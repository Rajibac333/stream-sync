"""
Request correlation.

Attaches an id to every request, exposes it to the logging system, and echoes
it back on the response so a client-reported problem can be traced to the exact
server-side log lines that produced it. (README §31)
"""

import logging
import uuid
from collections.abc import Callable
from contextvars import ContextVar

from django.http import HttpRequest, HttpResponse

REQUEST_ID_HEADER = "X-Request-ID"

# A ContextVar rather than thread-local storage: it stays correct under ASGI,
# where a single thread interleaves many in-flight requests. That matters from
# Milestone 7 onward, when Channels serves WebSockets in the same process.
_request_id: ContextVar[str] = ContextVar("request_id", default="-")


def get_request_id() -> str:
    """Return the current request's id, or "-" outside a request."""
    return _request_id.get()


class RequestIDFilter(logging.Filter):
    """Injects `request_id` into every record so formatters can print it."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


class RequestIDMiddleware:
    """
    Reads an inbound X-Request-ID or generates one.

    An upstream value is accepted so a trace spans the proxy and the frontend,
    but it is length-capped and never interpolated anywhere but a log field —
    the header is client-controlled input and is treated as such.
    """

    MAX_LENGTH = 64

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = self._sanitise(incoming) or uuid.uuid4().hex

        request.request_id = request_id
        token = _request_id.set(request_id)
        try:
            response = self.get_response(request)
        finally:
            # Reset even when the view raises, so a failed request cannot leak
            # its id into whatever the worker handles next.
            _request_id.reset(token)

        response[REQUEST_ID_HEADER] = request_id
        return response

    @staticmethod
    def _sanitise(value: str) -> str:
        """Keep only characters that are safe in a log field."""
        cleaned = "".join(
            char for char in value if char.isalnum() or char in {"-", "_"}
        )
        return cleaned[: RequestIDMiddleware.MAX_LENGTH]
