"""
Fixtures for the AI suite.

The stub provider is the whole reason these tests can exist without
credentials: it replaces the seam the service layer depends on, so a test can
pin an exact provider answer — or an exact provider failure — and assert what
the API does with it. Nothing here opens a socket. (Milestone 9: "add tests
using mocked AI responses", "do not make external AI calls during automated
tests".)
"""

from typing import Any

import pytest

from apps.ai import services

# A document with the structure the heuristics and the prompts both care
# about: headings, a settled decision, an owner named in the text, an explicit
# date and an urgency marker.
DOCUMENT_HTML = """
<h1>Payment Requirements</h1>
<p>The team is building a checkout system. We will use Stripe for card payments.</p>
<h2>Decisions</h2>
<ul>
  <li>Stripe was chosen for card payments.</li>
  <li>Guest checkout is approved for launch.</li>
</ul>
<h2>Next steps</h2>
<ul>
  <li>Editor User will implement the Stripe API by 2026-09-01.</li>
  <li>Design the checkout UI. This is urgent.</li>
</ul>
"""


class StubProvider:
    """
    A provider that answers with whatever the test tells it to.

    `engine` is deliberately not `mock-heuristic`: a test asserting that the
    response carries the engine that actually answered would pass by accident
    if the stub borrowed the deterministic provider's name.
    """

    engine = "stub-model"

    def __init__(self, payload: Any = None, error: Exception | None = None) -> None:
        self.payload = payload
        self.error = error
        self.requests: list[Any] = []

    def generate(self, request: Any) -> Any:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        return self.payload({}) if callable(self.payload) else self.payload


@pytest.fixture
def stub_provider(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Install a canned provider for the duration of one test."""

    def install(payload: Any = None, *, error: Exception | None = None) -> StubProvider:
        provider = StubProvider(payload=payload, error=error)
        monkeypatch.setattr(services, "get_provider", lambda: provider)
        return provider

    return install


@pytest.fixture
def ai_document(staffed_workspace: Any, owner: Any) -> Any:
    from apps.documents import services as document_services

    return document_services.create_document(
        workspace=staffed_workspace,
        author=owner,
        title="Payment Requirements",
        content=DOCUMENT_HTML,
    )


@pytest.fixture
def summary_payload() -> dict:
    return {
        "summary": "The team is building a checkout system on Stripe.",
        "key_points": ["Stripe for card payments", "Guest checkout at launch"],
        "decisions": ["Stripe was chosen for card payments."],
    }


@pytest.fixture
def action_items_payload() -> dict:
    return {
        "items": [
            {
                "title": "Implement the Stripe API",
                "assignee_name": "Editor User",
                "assignee_source": "named",
                "due_date": "2026-09-01",
                "priority": "high",
                "source_quote": (
                    "Editor User will implement the Stripe API by 2026-09-01."
                ),
                "source_section": "Next steps",
            },
            {
                "title": "Design the checkout UI",
                "assignee_name": None,
                "assignee_source": "suggested",
                "due_date": None,
                "priority": "urgent",
                "source_quote": "Design the checkout UI. This is urgent.",
                "source_section": "Next steps",
            },
        ]
    }
