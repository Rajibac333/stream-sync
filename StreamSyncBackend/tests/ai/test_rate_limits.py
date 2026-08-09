"""
Rate limiting on the AI endpoints.

These are the only requests in the product that cost money at a third party, so
they carry their own budget rather than sharing the general one. (README §24)

The suite disables throttling globally — shared process state otherwise makes
assertions depend on test order — so these tests re-enable it deliberately, the
same way tests/accounts/test_auth_throttling.py does. `override_settings` alone
would not work: `THROTTLE_RATES` is bound to the class at import.
"""

from typing import Any
from unittest import mock

import pytest
from django.core.cache import cache
from rest_framework.throttling import SimpleRateThrottle

SUMMARIZE = "/api/ai/summarize/"

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clear_throttle_history() -> Any:
    """Throttle counters live in the cache and would leak between tests."""
    cache.clear()
    yield
    cache.clear()


def test_a_burst_is_cut_off(
    client_for: Any,
    owner: Any,
    ai_document: Any,
    stub_provider: Any,
    summary_payload: dict,
) -> None:
    provider = stub_provider(summary_payload)
    client = client_for(owner)
    body = {"document_id": str(ai_document.id)}

    with mock.patch.object(
        SimpleRateThrottle, "THROTTLE_RATES", {"ai_burst": "2/min", "ai": "100/hour"}
    ):
        first = client.post(SUMMARIZE, body, format="json")
        second = client.post(SUMMARIZE, body, format="json")
        third = client.post(SUMMARIZE, body, format="json")

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    assert third.json()["error"]["code"] == "THROTTLED"

    # The point of the limit: the third request never reached the provider, so
    # it cost nothing.
    assert len(provider.requests) == 2


def test_the_hourly_budget_applies_independently_of_the_burst(
    client_for: Any,
    owner: Any,
    ai_document: Any,
    stub_provider: Any,
    summary_payload: dict,
) -> None:
    """A client can stay under the per-minute limit and still exhaust the hour."""
    stub_provider(summary_payload)
    client = client_for(owner)
    body = {"document_id": str(ai_document.id)}

    with mock.patch.object(
        SimpleRateThrottle, "THROTTLE_RATES", {"ai_burst": "100/min", "ai": "1/hour"}
    ):
        first = client.post(SUMMARIZE, body, format="json")
        second = client.post(SUMMARIZE, body, format="json")

    assert first.status_code == 200
    assert second.status_code == 429


def test_the_budget_is_per_user(
    client_for: Any,
    owner: Any,
    editor: Any,
    ai_document: Any,
    stub_provider: Any,
    summary_payload: dict,
) -> None:
    """
    Keyed on the account, not the address.

    A whole office behind one NAT address should not share one budget, and
    everything here is authenticated, so there is no anonymous case to cover.
    """
    stub_provider(summary_payload)
    body = {"document_id": str(ai_document.id)}

    with mock.patch.object(
        SimpleRateThrottle, "THROTTLE_RATES", {"ai_burst": "1/min", "ai": "100/hour"}
    ):
        assert client_for(owner).post(SUMMARIZE, body, format="json").status_code == 200
        assert client_for(owner).post(SUMMARIZE, body, format="json").status_code == 429
        # A different member is unaffected.
        assert (
            client_for(editor).post(SUMMARIZE, body, format="json").status_code == 200
        )
