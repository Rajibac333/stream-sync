"""
The Claude provider, with the transport replaced.

The SDK client is injected, so these tests exercise the real request-building
and the real error mapping while opening no socket and holding no credentials.
That is the only way to test this module and honour "do not make external AI
calls during automated tests" at the same time.
"""

import json
import logging
from typing import Any

import anthropic
import httpx
import pytest

from apps.ai.errors import (
    AiInvalidResponseError,
    AiNotConfiguredError,
    AiRateLimitedError,
    AiRefusedError,
    AiTimeoutError,
    AiUnavailableError,
)
from apps.ai.providers.anthropic_provider import AnthropicProvider
from apps.ai.providers.base import AiContext, AiRequest
from apps.ai.schemas import SUMMARY_SCHEMA

MODEL = "claude-opus-5"
API_KEY = "sk-ant-test-not-a-real-key-0000000000"

REQUEST = httpx.Request("POST", "https://api.anthropic.com/v1/messages")


class _Block:
    def __init__(self, text: str, block_type: str = "text") -> None:
        self.type = block_type
        self.text = text


class _Message:
    def __init__(self, text: str = "", *, stop_reason: str = "end_turn") -> None:
        self.content = [_Block(text)] if text else []
        self.stop_reason = stop_reason
        self.stop_details = None
        self.usage = type("Usage", (), {"input_tokens": 100, "output_tokens": 20})()


class _Messages:
    def __init__(self, result: Any) -> None:
        self.result = result
        self.calls: list[dict] = []

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class _Client:
    def __init__(self, result: Any) -> None:
        self.messages = _Messages(result)


def build(result: Any) -> AnthropicProvider:
    return AnthropicProvider(
        api_key=API_KEY,
        model=MODEL,
        timeout=5.0,
        max_retries=1,
        effort="medium",
        client=_Client(result),
    )


def sample_request() -> AiRequest:
    return AiRequest(
        operation="summarize",
        system="You are the writing assistant.",
        prompt="Document content: Stripe will be used.",
        schema=SUMMARY_SCHEMA,
        max_output_tokens=4096,
        context=AiContext(document_title="Payment Requirements"),
    )


def test_the_request_asks_for_structured_output() -> None:
    payload = {"summary": "A summary.", "key_points": [], "decisions": []}
    provider = build(_Message(json.dumps(payload)))

    assert provider.generate(sample_request()) == payload

    call = provider._client.messages.calls[0]
    assert call["model"] == MODEL
    assert call["max_tokens"] == 4096
    assert call["system"].startswith("You are the writing assistant")
    assert call["messages"] == [
        {"role": "user", "content": "Document content: Stripe will be used."}
    ]
    # Adaptive thinking with an effort ceiling, rather than a fixed token
    # budget: these are extraction tasks, not research.
    assert call["thinking"] == {"type": "adaptive"}
    assert call["output_config"]["effort"] == "medium"
    assert call["output_config"]["format"] == {
        "type": "json_schema",
        "schema": SUMMARY_SCHEMA,
    }


def test_the_engine_is_the_model_that_answered() -> None:
    """Provenance has to be true, so it comes from the provider."""
    assert build(_Message("{}")).engine == MODEL


def test_a_refusal_is_not_treated_as_an_outage() -> None:
    """
    Checked before the content is touched.

    Indexing `content[0]` on a refusal would turn a handled outcome into an
    IndexError, and retrying an identical request would produce an identical
    refusal — so it gets its own code.
    """
    provider = build(_Message("", stop_reason="refusal"))

    with pytest.raises(AiRefusedError):
        provider.generate(sample_request())


def test_a_truncated_response_is_rejected() -> None:
    """Constrained decoding guarantees the shape, not the ending."""
    provider = build(_Message('{"summary": "Half a sen', stop_reason="max_tokens"))

    with pytest.raises(AiInvalidResponseError):
        provider.generate(sample_request())


@pytest.mark.parametrize("text", ["", "Sure! Here is the summary:"])
def test_a_reply_that_is_not_json_is_rejected(text: str) -> None:
    provider = build(_Message(text))

    with pytest.raises(AiInvalidResponseError):
        provider.generate(sample_request())


@pytest.mark.parametrize(
    ("vendor_error", "expected"),
    [
        (anthropic.APITimeoutError(request=REQUEST), AiTimeoutError),
        (
            anthropic.RateLimitError(
                "slow down",
                response=httpx.Response(429, request=REQUEST),
                body=None,
            ),
            AiRateLimitedError,
        ),
        (
            anthropic.AuthenticationError(
                "bad key",
                response=httpx.Response(401, request=REQUEST),
                body=None,
            ),
            AiNotConfiguredError,
        ),
        (
            anthropic.InternalServerError(
                "boom", response=httpx.Response(500, request=REQUEST), body=None
            ),
            AiUnavailableError,
        ),
        (anthropic.APIConnectionError(request=REQUEST), AiUnavailableError),
        (ValueError("something else entirely"), AiUnavailableError),
    ],
)
def test_vendor_exceptions_are_translated(
    vendor_error: Exception, expected: type[Exception]
) -> None:
    """
    Nothing from the SDK escapes.

    Its exceptions render the request that produced them, and one of the
    headers on that request is the API key.
    """
    provider = build(vendor_error)

    with pytest.raises(expected):
        provider.generate(sample_request())


def test_the_failure_log_does_not_contain_the_key_or_the_vendor_message(
    caplog: pytest.LogCaptureFixture,
) -> None:
    provider = build(
        anthropic.AuthenticationError(
            f"invalid x-api-key: {API_KEY}",
            response=httpx.Response(401, request=REQUEST),
            body=None,
        )
    )

    # The `streamsync` loggers do not propagate to root (see LOGGING in
    # config/settings/base.py), so caplog's handler has to be attached to the
    # logger under test rather than relied on globally.
    ai_logger = logging.getLogger("streamsync.ai")
    ai_logger.addHandler(caplog.handler)
    try:
        with pytest.raises(AiNotConfiguredError):
            provider.generate(sample_request())
    finally:
        ai_logger.removeHandler(caplog.handler)

    logged = "\n".join(
        record.getMessage() + str(record.__dict__) for record in caplog.records
    )
    assert API_KEY not in logged
    # The class name is what an operator needs; the vendor's rendering of the
    # request is not.
    assert "AuthenticationError" in logged


def test_the_provider_does_not_keep_the_key_on_the_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    The key goes to the SDK client and nowhere else.

    An attribute holding it is one `repr()` in a traceback, a log record or a
    debug page away from being disclosed. (README §14, §25)
    """
    monkeypatch.setattr(
        anthropic, "Anthropic", lambda **kwargs: _Client(_Message("{}"))
    )

    provider = AnthropicProvider(
        api_key=API_KEY, model=MODEL, timeout=5.0, max_retries=1, effort="medium"
    )

    assert API_KEY not in repr(vars(provider))


def test_a_live_provider_without_a_key_is_refused() -> None:
    """A deployment fault, raised as a request error rather than at import."""
    with pytest.raises(AiNotConfiguredError):
        AnthropicProvider(
            api_key="", model=MODEL, timeout=5.0, max_retries=1, effort="medium"
        )


def test_the_timeout_is_passed_to_the_client(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    A request budget, not a hope.

    Without it the SDK's ten-minute default would hold a worker — and the
    user's browser — open far past the point the answer is useful.
    """
    captured: dict = {}

    def fake_client(**kwargs: Any) -> Any:
        captured.update(kwargs)
        return _Client(_Message("{}"))

    monkeypatch.setattr(anthropic, "Anthropic", fake_client)

    AnthropicProvider(
        api_key=API_KEY, model=MODEL, timeout=12.5, max_retries=2, effort="high"
    )

    assert captured["timeout"] == 12.5
    assert captured["max_retries"] == 2
