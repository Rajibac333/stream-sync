"""
What the client sees when the assistant cannot answer.

The requirement is that a provider failure produces a clear API error and never
crashes the application — a failed summary must leave the editor working.
(README §46)
"""

from typing import Any

import pytest

from apps.ai.errors import (
    AiInvalidResponseError,
    AiNotConfiguredError,
    AiRateLimitedError,
    AiRefusedError,
    AiTimeoutError,
    AiUnavailableError,
)

SUMMARIZE = "/api/ai/summarize/"

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (AiUnavailableError(), 503, "AI_SERVICE_UNAVAILABLE"),
        (AiTimeoutError(), 504, "AI_TIMEOUT"),
        (AiRateLimitedError(), 429, "AI_RATE_LIMITED"),
        (AiInvalidResponseError(), 503, "AI_INVALID_RESPONSE"),
        (AiRefusedError(), 422, "AI_REFUSED"),
        (AiNotConfiguredError(), 503, "AI_NOT_CONFIGURED"),
    ],
)
def test_provider_failures_map_to_stable_codes(
    client_for: Any,
    owner: Any,
    ai_document: Any,
    stub_provider: Any,
    error: Exception,
    status: int,
    code: str,
) -> None:
    stub_provider(error=error)

    response = client_for(owner).post(
        SUMMARIZE, {"document_id": str(ai_document.id)}, format="json"
    )

    assert response.status_code == status
    body = response.json()
    # The uniform envelope every other endpoint uses. (README §18)
    assert body["error"]["code"] == code
    assert body["error"]["message"]


def test_an_unexpected_provider_exception_becomes_an_outage_not_a_500(
    client_for: Any, owner: Any, ai_document: Any, stub_provider: Any
) -> None:
    """
    A bug in a provider is still the assistant being unavailable.

    Letting it surface as a 500 would tell the user their document is broken
    when the document is fine.
    """
    stub_provider(error=RuntimeError("provider exploded"))

    response = client_for(owner).post(
        SUMMARIZE, {"document_id": str(ai_document.id)}, format="json"
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_SERVICE_UNAVAILABLE"
    # And nothing internal leaks into the message.
    assert "exploded" not in response.json()["error"]["message"]


@pytest.mark.parametrize(
    "payload",
    [
        "not an object",
        {"key_points": [], "decisions": []},  # no summary
        {"summary": "", "key_points": [], "decisions": []},  # empty summary
        {"summary": 42, "key_points": [], "decisions": []},  # wrong type
    ],
)
def test_a_malformed_answer_is_reported_rather_than_crashing(
    client_for: Any, owner: Any, ai_document: Any, stub_provider: Any, payload: Any
) -> None:
    """
    Structured output makes this unlikely, not impossible.

    A truncated response is valid JSON up to the point it stops, so the
    payload is validated on the way out regardless of what constrained it.
    """
    stub_provider(payload)

    response = client_for(owner).post(
        SUMMARIZE, {"document_id": str(ai_document.id)}, format="json"
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_INVALID_RESPONSE"


def test_a_failed_summary_does_not_affect_the_document(
    client_for: Any, owner: Any, ai_document: Any, stub_provider: Any
) -> None:
    stub_provider(error=AiUnavailableError())
    client = client_for(owner)

    client.post(SUMMARIZE, {"document_id": str(ai_document.id)}, format="json")

    detail = client.get(f"/api/documents/{ai_document.id}/")
    assert detail.status_code == 200
    assert detail.json()["revision"] == ai_document.revision
