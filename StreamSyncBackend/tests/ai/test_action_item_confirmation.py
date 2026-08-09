"""
The two-step: propose, then confirm.

The rule this file exists to hold in place is that extraction creates nothing.
An assistant that misreads one sentence and files it as work assigned to a
colleague has done something the user cannot quietly undo, so the second
gesture is mandatory. (README §45, Milestone 9)
"""

from typing import Any

import pytest

from apps.activity.models import Activity, ActivityAction
from apps.tasks.models import Task

ACTION_ITEMS = "/api/ai/action-items/"
CONFIRM = "/api/ai/action-items/tasks/"

pytestmark = pytest.mark.django_db


def _payload(document: Any, project: Any, items: list[dict]) -> dict:
    return {
        "document_id": str(document.id),
        "project_id": str(project.id),
        "items": items,
    }


def test_extraction_creates_no_tasks(
    client_for: Any,
    owner: Any,
    ai_document: Any,
    stub_provider: Any,
    action_items_payload: dict,
) -> None:
    """The whole point. Extraction returns proposals and writes nothing."""
    stub_provider(action_items_payload)

    response = client_for(owner).post(
        ACTION_ITEMS, {"document_id": str(ai_document.id)}, format="json"
    )

    assert response.status_code == 200
    assert len(response.json()["items"]) == 2
    assert Task.objects.count() == 0


def test_confirmation_creates_the_items_as_sent(
    client_for: Any, owner: Any, editor: Any, ai_document: Any, project: Any
) -> None:
    """
    What is created is what was on screen.

    Extraction is not re-run here: the user edited the title before pressing
    the button, and re-deriving the list server-side would create something
    other than what they approved.
    """
    response = client_for(owner).post(
        CONFIRM,
        _payload(
            ai_document,
            project,
            [
                {
                    "title": "Implement Stripe API (edited by the user)",
                    "assignee_id": str(editor.id),
                    "due_date": "2026-09-01",
                    "priority": "high",
                    "source_quote": "Editor User will implement the Stripe API.",
                },
                {"title": "Design the checkout UI", "priority": "urgent"},
            ],
        ),
        format="json",
    )

    assert response.status_code == 201
    body = response.json()
    assert [task["title"] for task in body] == [
        "Implement Stripe API (edited by the user)",
        "Design the checkout UI",
    ]

    first = Task.objects.get(title__startswith="Implement Stripe")
    assert first.assignee_id == editor.id
    assert first.priority == "high"
    assert str(first.due_date) == "2026-09-01"
    assert first.project_id == project.id
    assert first.creator_id == owner.id
    # The quote travels with the task, so "why does this exist?" has an answer
    # six weeks later.
    assert "Editor User will implement" in first.description


def test_confirmation_records_activity(
    client_for: Any, owner: Any, ai_document: Any, project: Any
) -> None:
    client_for(owner).post(
        CONFIRM,
        _payload(ai_document, project, [{"title": "Design the checkout UI"}]),
        format="json",
    )

    entry = Activity.objects.filter(action=ActivityAction.AI_ACTION).first()
    assert entry is not None
    assert entry.metadata["context"] == "Created 1 tasks from action items"


def test_an_assignee_outside_the_workspace_leaves_the_task_unassigned(
    client_for: Any, owner: Any, outsider: Any, ai_document: Any, project: Any
) -> None:
    """
    One stale name must not lose the user the rest of the batch.

    The task lands unassigned and editable, which is recoverable; failing the
    whole confirmation is not.
    """
    response = client_for(owner).post(
        CONFIRM,
        _payload(
            ai_document,
            project,
            [
                {"title": "Implement Stripe API", "assignee_id": str(outsider.id)},
                {"title": "Design the checkout UI"},
            ],
        ),
        format="json",
    )

    assert response.status_code == 201
    assert Task.objects.count() == 2
    assert Task.objects.get(title="Implement Stripe API").assignee_id is None


def test_a_viewer_cannot_confirm(
    client_for: Any, viewer: Any, ai_document: Any, project: Any
) -> None:
    """Creating a task is an editor action however it was proposed."""
    response = client_for(viewer).post(
        CONFIRM,
        _payload(ai_document, project, [{"title": "Design the checkout UI"}]),
        format="json",
    )

    assert response.status_code == 403
    assert Task.objects.count() == 0


def test_an_outsider_cannot_confirm(
    client_for: Any, outsider: Any, ai_document: Any, project: Any
) -> None:
    response = client_for(outsider).post(
        CONFIRM,
        _payload(ai_document, project, [{"title": "Design the checkout UI"}]),
        format="json",
    )

    assert response.status_code == 404
    assert Task.objects.count() == 0


def test_a_project_from_another_workspace_is_rejected(
    client_for: Any, owner: Any, ai_document: Any, other_project: Any
) -> None:
    response = client_for(owner).post(
        CONFIRM,
        _payload(ai_document, other_project, [{"title": "Design the checkout UI"}]),
        format="json",
    )

    assert response.status_code == 404
    assert Task.objects.count() == 0


def test_an_empty_confirmation_is_rejected(
    client_for: Any, owner: Any, ai_document: Any, project: Any
) -> None:
    response = client_for(owner).post(
        CONFIRM, _payload(ai_document, project, []), format="json"
    )

    assert response.status_code == 400


def test_a_blank_title_is_rejected(
    client_for: Any, owner: Any, ai_document: Any, project: Any
) -> None:
    response = client_for(owner).post(
        CONFIRM, _payload(ai_document, project, [{"title": "   "}]), format="json"
    )

    assert response.status_code == 400
    assert Task.objects.count() == 0
