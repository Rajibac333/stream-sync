"""
Log formatting and redaction.

Logs are copied to aggregators, retained for months and read by people who are
not the account owner. Anything credential-shaped must never reach them.
(README §31)
"""

import json
import logging

from common.logging import REDACTED, ConsoleFormatter, JSONFormatter


def make_record(**extra: object) -> logging.LogRecord:
    record = logging.LogRecord(
        name="streamsync.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="user signed in",
        args=(),
        exc_info=None,
    )
    for key, value in extra.items():
        setattr(record, key, value)
    return record


class TestJSONFormatter:
    def test_emits_one_json_object_per_record(self) -> None:
        payload = json.loads(JSONFormatter().format(make_record()))

        assert payload["level"] == "INFO"
        assert payload["logger"] == "streamsync.test"
        assert payload["message"] == "user signed in"
        assert payload["timestamp"]

    def test_includes_structured_extra_fields(self) -> None:
        payload = json.loads(
            JSONFormatter().format(make_record(user_id="abc", path="/api/health/"))
        )

        assert payload["user_id"] == "abc"
        assert payload["path"] == "/api/health/"

    def test_redacts_credential_shaped_fields(self) -> None:
        record = make_record(
            password="hunter2",
            access_token="eyJhbGciOi",
            authorization="Bearer abc",
            api_key="sk-live-123",
            session_id="sess-1",
        )

        rendered = JSONFormatter().format(record)
        payload = json.loads(rendered)

        assert payload["password"] == REDACTED
        assert payload["access_token"] == REDACTED
        assert payload["authorization"] == REDACTED
        assert payload["api_key"] == REDACTED
        assert payload["session_id"] == REDACTED
        for secret in ("hunter2", "eyJhbGciOi", "Bearer abc", "sk-live-123"):
            assert secret not in rendered

    def test_matching_is_case_insensitive(self) -> None:
        payload = json.loads(
            JSONFormatter().format(make_record(**{"X-API-Key": "sk-live-123"}))
        )

        assert payload["X-API-Key"] == REDACTED

    def test_serialises_values_json_cannot_encode(self) -> None:
        """A stray UUID must not turn a log write into an application error."""
        import uuid

        payload = json.loads(
            JSONFormatter().format(make_record(workspace_id=uuid.uuid4()))
        )

        assert isinstance(payload["workspace_id"], str)


class TestConsoleFormatter:
    def test_renders_a_readable_line(self) -> None:
        formatter = ConsoleFormatter("%(levelname)s [%(request_id)s] %(message)s")
        record = make_record(request_id="req-1")

        assert formatter.format(record) == "INFO [req-1] user signed in"

    def test_appends_extra_fields(self) -> None:
        formatter = ConsoleFormatter("%(levelname)s [%(request_id)s] %(message)s")
        record = make_record(request_id="req-1", user_id="abc")

        assert formatter.format(record).endswith("user_id=abc")

    def test_redacts_secrets_too(self) -> None:
        formatter = ConsoleFormatter("%(levelname)s [%(request_id)s] %(message)s")
        record = make_record(request_id="req-1", password="hunter2")

        rendered = formatter.format(record)

        assert "hunter2" not in rendered
        assert REDACTED in rendered
