"""
Log formatters.

Two formats for two audiences: a compact line for a developer reading a
terminal, and one JSON object per line for a production log aggregator.
Neither ever renders credentials — see `SENSITIVE_KEYS`. (README §31)
"""

import json
import logging
from datetime import UTC, datetime

# Standard LogRecord attributes. Anything outside this set was attached by
# caller code via `extra=` and is therefore worth emitting.
_RESERVED_ATTRS = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "message",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)

# Field names whose values are redacted before they reach a log sink. Matching
# is substring-based and case-insensitive, so `auth_token` and `X-API-Key` are
# both caught. (README §31)
SENSITIVE_KEYS = (
    "password",
    "token",
    "secret",
    "authorization",
    "api_key",
    "apikey",
    "cookie",
    "session",
    "credential",
)

REDACTED = "[redacted]"


def _is_sensitive(key: str) -> bool:
    # Separators are normalised so one spelling in SENSITIVE_KEYS catches
    # `api_key`, `api-key`, `apiKey` and the `X-API-Key` header alike.
    normalised = key.lower().replace("-", "_").replace(" ", "_")
    return any(marker in normalised for marker in SENSITIVE_KEYS)


def _extra_fields(record: logging.LogRecord) -> dict[str, object]:
    """Structured fields attached by the caller, with secrets redacted."""
    return {
        key: REDACTED if _is_sensitive(key) else value
        for key, value in record.__dict__.items()
        if key not in _RESERVED_ATTRS and not key.startswith("_")
    }


class JSONFormatter(logging.Formatter):
    """One JSON object per line, ready for ingestion by a log pipeline."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        payload.update(_extra_fields(record))

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        # default=str keeps a stray UUID or datetime from turning a log write
        # into an application error.
        return json.dumps(payload, default=str)


class ConsoleFormatter(logging.Formatter):
    """Human-readable single line, with any `extra=` fields appended."""

    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)

        extras = {
            key: value
            for key, value in _extra_fields(record).items()
            if key != "request_id"  # already in the format string
        }
        if extras:
            rendered = " ".join(f"{key}={value}" for key, value in extras.items())
            return f"{base} {rendered}"
        return base
