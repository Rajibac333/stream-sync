"""
The four AI endpoints, against a stubbed provider.

These assert the contract the frontend consumes: field names, provenance, and
the small number of places where the server refuses to take the provider's word
for something.
"""

from typing import Any

import pytest

SUMMARIZE = "/api/ai/summarize/"
ACTION_ITEMS = "/api/ai/action-items/"
IMPROVE = "/api/ai/improve/"
ASK = "/api/ai/ask/"

pytestmark = pytest.mark.django_db


def test_summarize_returns_the_providers_answer(
    client_for: Any,
    owner: Any,
    ai_document: Any,
    stub_provider: Any,
    summary_payload: dict,
) -> None:
    provider = stub_provider(summary_payload)

    response = client_for(owner).post(
        SUMMARIZE, {"document_id": str(ai_document.id)}, format="json"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == summary_payload["summary"]
    assert body["key_points"] == summary_payload["key_points"]
    assert body["decisions"] == summary_payload["decisions"]
    # Provenance names the thing that actually answered, not the configuration.
    assert body["engine"] == "stub-model"
    assert body["generated_at"]

    # The document reached the provider as text, not as HTML.
    prompt = provider.requests[0].prompt
    assert "Stripe" in prompt
    assert "<p>" not in prompt


def test_unsaved_content_is_preferred_over_the_stored_body(
    client_for: Any,
    owner: Any,
    ai_document: Any,
    stub_provider: Any,
    summary_payload: dict,
) -> None:
    """The editor's live buffer is what the user is looking at."""
    provider = stub_provider(summary_payload)

    client_for(owner).post(
        SUMMARIZE,
        {
            "document_id": str(ai_document.id),
            "content": "<p>Apple Pay is now in scope.</p>",
        },
        format="json",
    )

    prompt = provider.requests[0].prompt
    assert "Apple Pay" in prompt
    assert "Stripe" not in prompt


def test_action_items_resolve_named_owners_to_members(
    client_for: Any,
    owner: Any,
    editor: Any,
    ai_document: Any,
    stub_provider: Any,
    action_items_payload: dict,
) -> None:
    stub_provider(action_items_payload)

    response = client_for(owner).post(
        ACTION_ITEMS, {"document_id": str(ai_document.id)}, format="json"
    )

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 2

    first = items[0]
    # The model returned a name; the id was resolved server-side against
    # workspace membership.
    assert first["assignee_id"] == str(editor.id)
    assert first["assignee_name"] == "Editor User"
    assert first["assignee_source"] == "named"
    assert first["due_date"] == "2026-09-01"
    assert first["priority"] == "high"
    assert first["source_quote"].startswith("Editor User will implement")
    # Ids are minted here, so the client has a stable handle while the user
    # edits the proposals.
    assert first["id"]

    assert items[1]["assignee_id"] is None
    assert items[1]["assignee_source"] == "suggested"


def test_action_items_never_invent_a_workspace_member(
    client_for: Any, owner: Any, ai_document: Any, stub_provider: Any
) -> None:
    stub_provider(
        {
            "items": [
                {
                    "title": "Ship the thing",
                    "assignee_name": "Nobody Here",
                    "assignee_source": "named",
                    "due_date": None,
                    "priority": "medium",
                    "source_quote": "Ship the thing.",
                    "source_section": None,
                }
            ]
        }
    )

    item = (
        client_for(owner)
        .post(ACTION_ITEMS, {"document_id": str(ai_document.id)}, format="json")
        .json()["items"][0]
    )

    # The name is kept so the user can see what was proposed; the id is not
    # invented, so nothing can be assigned to a stranger.
    assert item["assignee_name"] == "Nobody Here"
    assert item["assignee_id"] is None


def test_action_items_without_a_quote_are_dropped(
    client_for: Any, owner: Any, ai_document: Any, stub_provider: Any
) -> None:
    """An item nobody can check against the document is worth less than none."""
    stub_provider(
        {
            "items": [
                {
                    "title": "Unverifiable work",
                    "assignee_name": None,
                    "assignee_source": "suggested",
                    "due_date": None,
                    "priority": "medium",
                    "source_quote": "",
                    "source_section": None,
                },
                {
                    "title": "Real work",
                    "assignee_name": None,
                    "assignee_source": "suggested",
                    "due_date": None,
                    "priority": "medium",
                    "source_quote": "Design the checkout UI.",
                    "source_section": None,
                },
            ]
        }
    )

    items = (
        client_for(owner)
        .post(ACTION_ITEMS, {"document_id": str(ai_document.id)}, format="json")
        .json()["items"]
    )

    assert [item["title"] for item in items] == ["Real work"]


def test_improve_returns_rewritten_text(
    client_for: Any, owner: Any, ai_document: Any, stub_provider: Any
) -> None:
    stub_provider(
        {
            "text": "Stripe handles card payments.",
            "note": "Removed hedging.",
            "changed": True,
        }
    )

    response = client_for(owner).post(
        IMPROVE,
        {
            "document_id": str(ai_document.id),
            "text": "I think Stripe probably handles card payments.",
            "mode": "improve",
        },
        format="json",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "Stripe handles card payments."
    assert body["changed"] is True
    assert body["note"] == "Removed hedging."


def test_improve_corrects_a_provider_that_claims_a_change_it_did_not_make(
    client_for: Any, owner: Any, ai_document: Any, stub_provider: Any
) -> None:
    """
    `changed` is checked against the text, not taken on trust.

    "Improved" over an identical paragraph is a claim the user acts on, so the
    comparison wins over the provider's own account of itself.
    """
    original = "Stripe handles card payments."
    stub_provider({"text": original, "note": "Tightened the wording.", "changed": True})

    body = (
        client_for(owner)
        .post(
            IMPROVE,
            {"document_id": str(ai_document.id), "text": original, "mode": "improve"},
            format="json",
        )
        .json()
    )

    assert body["text"] == original
    assert body["changed"] is False


def test_improve_requires_a_tone_when_the_mode_is_tone(
    client_for: Any, owner: Any, ai_document: Any
) -> None:
    response = client_for(owner).post(
        IMPROVE,
        {"document_id": str(ai_document.id), "text": "Some text.", "mode": "tone"},
        format="json",
    )

    assert response.status_code == 400
    assert "tone" in response.json()["error"]["details"]


def test_ask_returns_citations_when_grounded(
    client_for: Any, owner: Any, ai_document: Any, stub_provider: Any
) -> None:
    stub_provider(
        {
            "answer": "Stripe.",
            "citations": [
                {"quote": "We will use Stripe for card payments.", "section": None}
            ],
            "grounded": True,
        }
    )

    body = (
        client_for(owner)
        .post(
            ASK,
            {"document_id": str(ai_document.id), "question": "Which provider?"},
            format="json",
        )
        .json()
    )

    assert body["grounded"] is True
    assert body["citations"][0]["quote"].startswith("We will use Stripe")


def test_ungrounded_answers_cite_nothing(
    client_for: Any, owner: Any, ai_document: Any, stub_provider: Any
) -> None:
    """An "it doesn't say" that comes with sources contradicts itself."""
    stub_provider(
        {
            "answer": "The document does not cover refunds.",
            "citations": [{"quote": "Stripe was chosen.", "section": "Decisions"}],
            "grounded": False,
        }
    )

    body = (
        client_for(owner)
        .post(
            ASK,
            {
                "document_id": str(ai_document.id),
                "question": "What is the refund policy?",
            },
            format="json",
        )
        .json()
    )

    assert body["grounded"] is False
    assert body["citations"] == []


def test_ask_requires_a_question(client_for: Any, owner: Any, ai_document: Any) -> None:
    response = client_for(owner).post(
        ASK, {"document_id": str(ai_document.id), "question": "   "}, format="json"
    )

    assert response.status_code == 400


@pytest.mark.parametrize("path", [SUMMARIZE, ACTION_ITEMS, ASK])
def test_endpoints_require_authentication(
    api_client: Any, ai_document: Any, path: str
) -> None:
    response = api_client.post(
        path,
        {"document_id": str(ai_document.id), "question": "Anything?"},
        format="json",
    )

    assert response.status_code == 401


def test_a_document_in_another_workspace_is_not_found(
    client_for: Any,
    owner: Any,
    other_document: Any,
    stub_provider: Any,
    summary_payload: dict,
) -> None:
    """
    404, not 403.

    A 403 would confirm the document exists, which is enough to enumerate ids
    across tenants. (README §16)
    """
    provider = stub_provider(summary_payload)

    response = client_for(owner).post(
        SUMMARIZE, {"document_id": str(other_document.id)}, format="json"
    )

    assert response.status_code == 404
    # And the outsider's document never reached a provider.
    assert provider.requests == []


def test_a_mismatched_workspace_id_is_rejected(
    client_for: Any, owner: Any, ai_document: Any, other_workspace: Any
) -> None:
    response = client_for(owner).post(
        SUMMARIZE,
        {
            "document_id": str(ai_document.id),
            "workspace_id": str(other_workspace.id),
        },
        format="json",
    )

    assert response.status_code == 400


def test_a_viewer_may_use_the_assistant(
    client_for: Any,
    viewer: Any,
    ai_document: Any,
    stub_provider: Any,
    summary_payload: dict,
) -> None:
    """Reading the assistant's opinion is a read. (README §20)"""
    stub_provider(summary_payload)

    response = client_for(viewer).post(
        SUMMARIZE, {"document_id": str(ai_document.id)}, format="json"
    )

    assert response.status_code == 200
