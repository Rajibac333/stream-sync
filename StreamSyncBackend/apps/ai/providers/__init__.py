"""
Choosing a provider.

One function, called by the service layer. Which implementation it returns is
configuration, so switching vendors — or running with none — never touches a
view, a serializer or a test.

The instance is cached per process. Building an SDK client sets up a connection
pool; doing that per request would discard the pool every time and add a TLS
handshake to every summary.
"""

import logging
import threading

from django.conf import settings

from ..errors import AiNotConfiguredError
from .base import AiContext, AiProvider, AiRequest
from .mock import MOCK_ENGINE, MockProvider

logger = logging.getLogger("streamsync.ai")

MOCK = "mock"
ANTHROPIC = "anthropic"
GROQ = "groq"

_lock = threading.Lock()
_provider: AiProvider | None = None
_provider_name: str | None = None


def build_provider(name: str) -> AiProvider:
    """Construct a provider by name, without caching."""
    if name == MOCK:
        return MockProvider()

    if name == ANTHROPIC:
        # Imported here, not at module scope: a deployment running the
        # deterministic provider must not need the vendor SDK installed.
        from .anthropic_provider import AnthropicProvider

        return AnthropicProvider(
            # The one place the key is read. It is never re-exported, never
            # logged, and never reaches a serializer. (README §14, §25)
            api_key=settings.AI_API_KEY,
            model=settings.AI_MODEL,
            timeout=settings.AI_TIMEOUT_SECONDS,
            max_retries=settings.AI_MAX_RETRIES,
            effort=settings.AI_EFFORT,
        )

    if name == GROQ:
        # Imported here, not at module scope: a deployment running the
        # deterministic provider must not need the vendor SDK installed.
        from .groq_provider import GroqProvider

        return GroqProvider(
            # The one place the key is read. It is never re-exported, never
            # logged, and never reaches a serializer. (README §14, §25)
            api_key=settings.AI_API_KEY,
            model=settings.AI_MODEL,
            timeout=settings.AI_TIMEOUT_SECONDS,
            max_retries=settings.AI_MAX_RETRIES,
        )

    raise AiNotConfiguredError(f"Unknown AI provider: {name}", extra={"provider": name})


def get_provider() -> AiProvider:
    """
    The configured provider for this process.

    Built on first use rather than at import, because construction can fail on
    a misconfigured deployment and that failure belongs to a request — which
    returns 503 — not to application start-up, which would take the whole
    product down over one feature.
    """
    global _provider, _provider_name

    name = settings.AI_PROVIDER
    if _provider is not None and _provider_name == name:
        return _provider

    with _lock:
        if _provider is None or _provider_name != name:
            provider = build_provider(name)
            logger.info(
                "AI provider initialised",
                extra={
                    "provider": name,
                    # The engine, which is a model id or `mock-heuristic`.
                    # Never the key, and never a prefix of it.
                    "engine": provider.engine,
                    "event": "ai.provider_initialised",
                },
            )
            _provider, _provider_name = provider, name

    return _provider


def reset_provider_cache() -> None:
    """Drop the cached provider. Used by tests that change configuration."""
    global _provider, _provider_name
    with _lock:
        _provider, _provider_name = None, None


__all__ = [
    "ANTHROPIC",
    "GROQ",
    "MOCK",
    "MOCK_ENGINE",
    "AiContext",
    "AiProvider",
    "AiRequest",
    "MockProvider",
    "build_provider",
    "get_provider",
    "reset_provider_cache",
]
