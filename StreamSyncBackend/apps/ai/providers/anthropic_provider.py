"""
The Claude provider.

The only module in the codebase that holds an API key or opens a socket to a
model vendor. It is reached exclusively through `AiProvider`, so nothing above
it imports the SDK, and the browser reaches it through Django or not at all:

    React → Django → AI service → provider          ✅
    React → provider                                ❌

(README §14, §50; frontend CLAUDE.md §9, §50)

THE KEY

Read once from settings, held on the client, and never logged, serialised or
placed in an error payload. That last one is why every vendor exception is
converted here rather than allowed to propagate: an SDK exception carries the
request that produced it, and the request carries the `x-api-key` header.

STRUCTURED OUTPUT

Each operation names a JSON Schema and the model is constrained to it, which is
what makes a response parseable without prompting tricks or regex salvage. The
reply is still validated in `schemas.py`: a truncated response is valid JSON up
to the point it stops, and constrained decoding does not make it complete.
"""

import json
import logging
import time
from typing import Any

from ..errors import (
    AiInvalidResponseError,
    AiNotConfiguredError,
    AiRateLimitedError,
    AiRefusedError,
    AiTimeoutError,
    AiUnavailableError,
)
from .base import AiRequest

logger = logging.getLogger("streamsync.ai")


class AnthropicProvider:
    """Answers `AiRequest`s with Claude."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        timeout: float,
        max_retries: int,
        effort: str,
        client: Any | None = None,
    ) -> None:
        self.engine = model
        self._model = model
        self._effort = effort
        self._timeout = timeout

        if client is not None:
            # Injected by tests. It is the reason no automated test needs
            # credentials or a network: the transport is replaced, not mocked
            # at the HTTP layer.
            self._client = client
            return

        if not api_key:
            raise AiNotConfiguredError

        import anthropic

        self._client = anthropic.Anthropic(
            api_key=api_key,
            # A request budget, not a hope. Without it the SDK's ten-minute
            # default would hold a worker — and the user's browser — open far
            # past the point the answer is useful.
            timeout=timeout,
            # The SDK retries connection errors and 429/5xx itself. One extra
            # attempt is worth having; more would multiply the wall-clock time
            # a user waits by the number of retries.
            max_retries=max_retries,
        )

    def generate(self, request: AiRequest) -> dict[str, Any]:
        started = time.monotonic()

        try:
            message = self._client.messages.create(
                model=self._model,
                max_tokens=request.max_output_tokens,
                system=request.system,
                messages=[{"role": "user", "content": request.prompt}],
                # Adaptive thinking: the model decides how much reasoning each
                # document needs. `effort` is the cost lever instead of a fixed
                # token budget — these are extraction and rewriting tasks, not
                # research.
                thinking={"type": "adaptive"},
                output_config={
                    "effort": self._effort,
                    "format": {"type": "json_schema", "schema": request.schema},
                },
            )
        except Exception as exc:
            raise self._translate(exc, operation=request.operation) from None

        elapsed_ms = int((time.monotonic() - started) * 1000)
        payload = self._read(message, operation=request.operation)

        usage = getattr(message, "usage", None)
        logger.info(
            "AI request completed",
            extra={
                # Deliberately no prompt, no document text and no answer. The
                # operation, the model and the cost are what an operator needs;
                # the user's document is not. (README §31, Milestone 9)
                "operation": request.operation,
                "model": self._model,
                "duration_ms": elapsed_ms,
                "input_tokens": getattr(usage, "input_tokens", None),
                "output_tokens": getattr(usage, "output_tokens", None),
                "event": "ai.request_completed",
            },
        )

        return payload

    # -- response ----------------------------------------------------------

    def _read(self, message: Any, *, operation: str) -> dict[str, Any]:
        stop_reason = getattr(message, "stop_reason", None)

        # Checked before the content is touched. On a refusal `content` is
        # empty or partial, and indexing it would turn a handled outcome into
        # an IndexError.
        if stop_reason == "refusal":
            logger.warning(
                "AI request refused",
                extra={
                    "operation": operation,
                    "model": self._model,
                    "category": getattr(
                        getattr(message, "stop_details", None), "category", None
                    ),
                    "event": "ai.refused",
                },
            )
            raise AiRefusedError

        if stop_reason == "max_tokens":
            # Constrained decoding guarantees the shape, not the ending. What
            # arrives is a prefix of valid JSON, which is not valid JSON.
            logger.error(
                "AI response truncated",
                extra={
                    "operation": operation,
                    "model": self._model,
                    "event": "ai.truncated",
                },
            )
            raise AiInvalidResponseError

        text = "".join(
            block.text
            for block in getattr(message, "content", [])
            if getattr(block, "type", None) == "text"
        ).strip()

        if not text:
            logger.error(
                "AI response contained no text",
                extra={
                    "operation": operation,
                    "model": self._model,
                    "stop_reason": stop_reason,
                    "event": "ai.empty_response",
                },
            )
            raise AiInvalidResponseError

        try:
            payload = json.loads(text)
        except ValueError:
            logger.error(
                "AI response was not valid JSON",
                extra={
                    "operation": operation,
                    "model": self._model,
                    # Length only. The body is the user's document reflected
                    # back and has no place in an operational log.
                    "response_length": len(text),
                    "event": "ai.invalid_json",
                },
            )
            raise AiInvalidResponseError from None

        return payload

    # -- errors ------------------------------------------------------------

    def _translate(self, exc: Exception, *, operation: str) -> AiUnavailableError:
        """
        Map a vendor exception onto this application's error vocabulary.

        Imported inside the function so the module stays importable — and the
        error path stays testable — on a machine where the SDK is absent.
        """
        import anthropic

        if isinstance(exc, anthropic.APITimeoutError):
            error: AiUnavailableError = AiTimeoutError()
            event = "ai.timeout"
        elif isinstance(exc, anthropic.RateLimitError):
            error = AiRateLimitedError()
            event = "ai.rate_limited"
        elif isinstance(
            exc, anthropic.AuthenticationError | anthropic.PermissionDeniedError
        ):
            # A rejected key is a deployment fault, not a transient one, and it
            # must be loud in the logs — the user still gets the same neutral
            # "temporarily unavailable".
            error = AiNotConfiguredError()
            event = "ai.credentials_rejected"
        elif isinstance(exc, anthropic.AnthropicError):
            error = AiUnavailableError()
            event = "ai.provider_error"
        else:
            error = AiUnavailableError()
            event = "ai.unexpected_error"

        logger.error(
            "AI request failed",
            extra={
                "operation": operation,
                "model": self._model,
                # The class name, never `str(exc)`: an SDK exception renders the
                # request that produced it, headers included.
                "error_type": type(exc).__name__,
                "timeout_seconds": self._timeout,
                "event": event,
            },
        )

        return error
