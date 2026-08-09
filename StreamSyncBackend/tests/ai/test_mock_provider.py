"""
The deterministic provider, end to end.

This is what a checkout with no credentials actually runs, so it is exercised
through the real endpoints rather than in isolation. The assertions are about
honesty as much as behaviour: it reads the document, and it says what produced
the answer.
"""

from typing import Any

import pytest

from apps.ai.providers.mock import MOCK_ENGINE

SUMMARIZE = "/api/ai/summarize/"
ACTION_ITEMS = "/api/ai/action-items/"
IMPROVE = "/api/ai/improve/"
ASK = "/api/ai/ask/"

pytestmark = pytest.mark.django_db


def test_the_configured_provider_in_tests_reaches_no_network(settings: Any) -> None:
    """
    The guarantee behind "no external AI calls during automated tests".

    It is structural rather than conventional: the provider the suite runs
    contains no HTTP client and no credentials, so a test cannot call a vendor
    even by mistake.
    """
    assert settings.AI_PROVIDER == "mock"
    assert settings.AI_API_KEY == ""


def test_summary_is_derived_from_the_document(
    client_for: Any, owner: Any, ai_document: Any
) -> None:
    body = (
        client_for(owner)
        .post(SUMMARIZE, {"document_id": str(ai_document.id)}, format="json")
        .json()
    )

    # Real content, not a canned string.
    assert "Stripe" in body["summary"]
    # The document's own headings are its outline.
    assert "Decisions" in body["key_points"]
    assert any(
        "chosen" in decision or "approved" in decision for decision in body["decisions"]
    )
    # And it says what it is.
    assert body["engine"] == MOCK_ENGINE


def test_action_items_come_from_lines_that_describe_work(
    client_for: Any, owner: Any, editor: Any, ai_document: Any
) -> None:
    items = (
        client_for(owner)
        .post(ACTION_ITEMS, {"document_id": str(ai_document.id)}, format="json")
        .json()["items"]
    )

    titles = [item["title"] for item in items]
    assert any("Stripe API" in title for title in titles)

    stripe_item = next(item for item in items if "Stripe API" in item["title"])
    # The roster is what makes an owner resolvable; a capitalised word is not.
    assert stripe_item["assignee_id"] == str(editor.id)
    assert stripe_item["assignee_source"] == "named"
    assert stripe_item["due_date"] == "2026-09-01"
    assert stripe_item["source_section"] == "Next steps"
    # Every proposal is quotable, so the user can check it before accepting it.
    assert all(item["source_quote"] for item in items)

    urgent = next(item for item in items if "checkout UI" in item["title"])
    assert urgent["priority"] == "urgent"
    assert urgent["assignee_id"] is None


def test_an_empty_document_yields_no_action_items(
    client_for: Any, owner: Any, staffed_workspace: Any, editor: Any
) -> None:
    from apps.documents import services

    empty = services.create_document(
        workspace=staffed_workspace, author=editor, title="Blank", content=""
    )

    body = (
        client_for(owner)
        .post(ACTION_ITEMS, {"document_id": str(empty.id)}, format="json")
        .json()
    )

    assert body["items"] == []


def test_improve_removes_hedging(client_for: Any, owner: Any, ai_document: Any) -> None:
    body = (
        client_for(owner)
        .post(
            IMPROVE,
            {
                "document_id": str(ai_document.id),
                "text": "I think Stripe is really just the best option.",
                "mode": "improve",
            },
            format="json",
        )
        .json()
    )

    assert body["changed"] is True
    assert "I think" not in body["text"]
    assert "really" not in body["text"]
    # And the result still reads as a sentence: stripping a leading phrase
    # must not leave the user pasting "stripe is the best option." into their
    # document.
    assert body["text"].startswith("Stripe is the best option")


def test_expand_says_plainly_that_it_cannot(
    client_for: Any, owner: Any, ai_document: Any
) -> None:
    """
    The honest answer beats a padded one.

    There is no deterministic way to add content that is not in the input, and
    filler dressed up as an improvement is a rewrite the user did not ask for.
    """
    original = "Stripe handles card payments."

    body = (
        client_for(owner)
        .post(
            IMPROVE,
            {"document_id": str(ai_document.id), "text": original, "mode": "expand"},
            format="json",
        )
        .json()
    )

    assert body["text"] == original
    assert body["changed"] is False
    assert "language model" in body["note"]


def test_tone_rewrites_are_applied(
    client_for: Any, owner: Any, ai_document: Any
) -> None:
    body = (
        client_for(owner)
        .post(
            IMPROVE,
            {
                "document_id": str(ai_document.id),
                "text": "We can't ship this yet.",
                "mode": "tone",
                "tone": "professional",
            },
            format="json",
        )
        .json()
    )

    assert "cannot" in body["text"]
    assert body["changed"] is True


def test_ask_answers_from_the_document_with_citations(
    client_for: Any, owner: Any, ai_document: Any
) -> None:
    body = (
        client_for(owner)
        .post(
            ASK,
            {
                "document_id": str(ai_document.id),
                "question": "Which provider is used for card payments?",
            },
            format="json",
        )
        .json()
    )

    assert body["grounded"] is True
    assert "Stripe" in body["answer"]
    assert body["citations"]
    # Citations are quotes from the document, not paraphrases.
    document_text = "".join(citation["quote"] for citation in body["citations"])
    assert "Stripe" in document_text


def test_ask_says_when_the_document_does_not_cover_it(
    client_for: Any, owner: Any, ai_document: Any
) -> None:
    """The one answer that must never be improvised."""
    body = (
        client_for(owner)
        .post(
            ASK,
            {
                "document_id": str(ai_document.id),
                "question": "What is the parental leave policy?",
            },
            format="json",
        )
        .json()
    )

    assert body["grounded"] is False
    assert body["citations"] == []
    assert "does not" in body["answer"]
