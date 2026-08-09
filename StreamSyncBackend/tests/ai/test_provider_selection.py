"""
Choosing a provider.

The seam that makes the rest of the milestone possible: which implementation
answers is configuration, and getting that wrong is a deployment fault that
must surface as a 503 rather than as a process that will not start.
"""

from typing import Any

import pytest

from apps.ai.errors import AiNotConfiguredError
from apps.ai.providers import (
    ANTHROPIC,
    MOCK,
    MOCK_ENGINE,
    MockProvider,
    build_provider,
    get_provider,
    reset_provider_cache,
)


@pytest.fixture(autouse=True)
def clear_provider_cache() -> Any:
    reset_provider_cache()
    yield
    reset_provider_cache()


def test_the_deterministic_provider_names_itself_honestly() -> None:
    provider = build_provider(MOCK)

    assert isinstance(provider, MockProvider)
    # Not a model id. A UI showing provenance says the true thing because this
    # value is true.
    assert provider.engine == MOCK_ENGINE


def test_an_unknown_provider_is_a_configuration_error() -> None:
    with pytest.raises(AiNotConfiguredError):
        build_provider("some-vendor")


def test_a_live_provider_without_a_key_is_refused(settings: Any) -> None:
    settings.AI_API_KEY = ""

    with pytest.raises(AiNotConfiguredError):
        build_provider(ANTHROPIC)


def test_the_provider_is_built_once_per_process(settings: Any) -> None:
    """Building an SDK client sets up a connection pool; one per request would
    discard it every time."""
    settings.AI_PROVIDER = MOCK

    assert get_provider() is get_provider()


def test_changing_configuration_rebuilds_it(settings: Any) -> None:
    settings.AI_PROVIDER = MOCK
    first = get_provider()

    reset_provider_cache()
    second = get_provider()

    assert first is not second


def test_a_misconfigured_deployment_still_boots(settings: Any) -> None:
    """
    The failure belongs to a request, not to start-up.

    Raising at import would take the whole product down over one feature; here
    the editor, tasks and documents keep working and only the assistant
    reports itself unavailable.
    """
    settings.AI_PROVIDER = "not-a-provider"
    settings.AI_API_KEY = ""

    with pytest.raises(AiNotConfiguredError):
        get_provider()
