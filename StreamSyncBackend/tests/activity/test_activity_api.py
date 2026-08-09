"""
The activity timeline endpoint.

The feed names documents, tasks and people, so a leak here discloses the shape
of another team's work even without exposing the objects themselves. Isolation
gets as much attention as the happy path.
"""

import uuid
from typing import Any

import pytest
from django.urls import reverse

from apps.activity.models import Activity, ActivityAction, EntityType

pytestmark = pytest.mark.django_db

LIST_URL = reverse("activity:list")
DOCUMENTS_URL = reverse("documents:list-create")
TASKS_URL = reverse("tasks:list-create")


def actions_in(body: dict) -> list[str]:
    return [entry["action"] for entry in body["results"]]


class TestActivityFeed:
    def test_lists_entries_for_my_workspace(
        self, client_for: Any, staffed_workspace: Any, task: Any, owner: Any
    ) -> None:
        response = client_for(owner).get(LIST_URL)

        assert response.status_code == 200
        assert ActivityAction.TASK_CREATED in actions_in(response.json())

    def test_newest_first(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        client.post(
            TASKS_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "project_id": str(project.id),
                "title": "Later task",
            },
        )

        results = client.get(LIST_URL).json()["results"]

        assert results[0]["target"]["name"] == "Later task"

        # Asserted as a property of the whole page rather than by naming the
        # last entry: which fixture event is oldest changes whenever a new
        # activity hook is added, but the ordering must always hold.
        timestamps = [entry["created_at"] for entry in results]
        assert timestamps == sorted(timestamps, reverse=True)

    def test_entry_carries_actor_target_and_context(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        client_for(owner).post(
            TASKS_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "project_id": str(project.id),
                "title": "Implement Stripe",
            },
        )

        entry = client_for(owner).get(LIST_URL).json()["results"][0]

        assert entry["workspace_id"] == str(staffed_workspace.id)
        assert entry["actor"]["id"] == str(owner.id)
        assert set(entry["actor"]) == {"id", "name", "avatar_url"}
        assert entry["target"]["type"] == EntityType.TASK
        assert entry["target"]["name"] == "Implement Stripe"
        assert entry["target"]["href"]
        assert entry["context"] == project.name
        assert entry["created_at"]

    def test_is_paginated(self, client_for: Any, task: Any, owner: Any) -> None:
        body = client_for(owner).get(LIST_URL).json()

        assert {"count", "page", "page_size", "total_pages", "results"} <= set(body)

    def test_every_member_role_can_read_the_feed(
        self,
        client_for: Any,
        task: Any,
        owner: Any,
        editor: Any,
        viewer: Any,
    ) -> None:
        """Seeing what the team did is not a privileged action."""
        for member in (owner, editor, viewer):
            assert client_for(member).get(LIST_URL).status_code == 200, member.email

    def test_requires_authentication(self, api_client: Any) -> None:
        assert api_client.get(LIST_URL).status_code == 401


class TestActivityIsolation:
    def test_excludes_other_workspaces(
        self, client_for: Any, task: Any, other_task: Any, owner: Any
    ) -> None:
        """The core isolation guarantee for the timeline."""
        results = client_for(owner).get(LIST_URL).json()["results"]

        names = [entry["target"]["name"] for entry in results]
        assert "Implement Stripe API" in names
        assert "Rival Task" not in names

    def test_non_member_sees_an_empty_feed(
        self, client_for: Any, task: Any, user_factory: Any
    ) -> None:
        stranger = user_factory(email="stranger@streamsync.test")

        body = client_for(stranger).get(LIST_URL).json()

        assert body["results"] == []

    def test_filtering_by_someone_elses_workspace_returns_nothing(
        self, client_for: Any, task: Any, other_workspace: Any, owner: Any
    ) -> None:
        """A workspace id the caller cannot see matches nothing rather than leaking."""
        body = (
            client_for(owner)
            .get(LIST_URL, {"workspace": str(other_workspace.id)})
            .json()
        )

        assert body["results"] == []

    def test_the_feed_is_read_only(
        self, client_for: Any, task: Any, owner: Any
    ) -> None:
        """An audit trail with a write API is not an audit trail."""
        response = client_for(owner).post(LIST_URL, {"action": "task_created"})

        assert response.status_code == 405


class TestActivityFiltering:
    def test_filters_by_workspace(
        self, client_for: Any, task: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        body = (
            client_for(owner)
            .get(LIST_URL, {"workspace": str(staffed_workspace.id)})
            .json()
        )

        assert body["count"] > 0

    def test_filters_by_action(
        self, client_for: Any, task: Any, project: Any, owner: Any
    ) -> None:
        body = (
            client_for(owner)
            .get(LIST_URL, {"action": ActivityAction.PROJECT_CREATED})
            .json()
        )

        assert actions_in(body) == [ActivityAction.PROJECT_CREATED]

    def test_filters_by_entity_type(
        self, client_for: Any, task: Any, owner: Any
    ) -> None:
        body = client_for(owner).get(LIST_URL, {"entity_type": EntityType.TASK}).json()

        assert all(e["target"]["type"] == EntityType.TASK for e in body["results"])

    def test_filters_to_one_objects_history(
        self, client_for: Any, task: Any, owner: Any
    ) -> None:
        """Powers a "what happened to this task" panel."""
        client_for(owner).patch(
            reverse("tasks:detail", args=[task.id]), {"status": "done"}
        )

        body = client_for(owner).get(LIST_URL, {"entity": str(task.id)}).json()

        assert sorted(actions_in(body)) == [
            ActivityAction.TASK_COMPLETED,
            ActivityAction.TASK_CREATED,
        ]

    def test_unknown_filter_values_are_ignored(
        self, client_for: Any, task: Any, owner: Any
    ) -> None:
        """An invalid filter must not error, nor silently widen the result."""
        body = client_for(owner).get(LIST_URL, {"action": "nonsense"}).json()

        assert body["count"] > 0


class TestActivityGeneration:
    def test_creating_a_project_is_recorded(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        client_for(owner).post(
            reverse("projects:list-create"),
            {"workspace_id": str(staffed_workspace.id), "name": "New Project"},
        )

        entry = (
            client_for(owner)
            .get(LIST_URL, {"action": ActivityAction.PROJECT_CREATED})
            .json()["results"][0]
        )

        assert entry["target"]["name"] == "New Project"
        assert entry["target"]["type"] == EntityType.PROJECT

    def test_creating_a_document_is_recorded(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        client_for(owner).post(
            DOCUMENTS_URL,
            {"workspace_id": str(staffed_workspace.id), "title": "Spec"},
        )

        entry = (
            client_for(owner)
            .get(LIST_URL, {"action": ActivityAction.DOCUMENT_CREATED})
            .json()["results"][0]
        )

        assert entry["target"]["name"] == "Spec"

    def test_editing_a_document_is_recorded(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        client_for(editor).patch(
            reverse("documents:detail", args=[document.id]),
            {"content": "<p>Changed.</p>"},
        )

        body = (
            client_for(editor)
            .get(LIST_URL, {"action": ActivityAction.DOCUMENT_EDITED})
            .json()
        )

        assert body["count"] == 1
        assert body["results"][0]["actor"]["id"] == str(editor.id)

    def test_repeated_edits_collapse_into_one_entry(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        """
        Versions capture every save; the feed does not. Forty "Maria edited
        Payment Requirements" entries from one afternoon is a feed nobody
        reads.
        """
        client = client_for(editor)
        url = reverse("documents:detail", args=[document.id])

        for index in range(4):
            client.patch(url, {"content": f"<p>Edit {index}</p>"})

        body = client.get(LIST_URL, {"action": ActivityAction.DOCUMENT_EDITED}).json()

        assert body["count"] == 1
        # Every save still produced a version.
        assert document.versions.count() == 5

    def test_a_different_editor_gets_their_own_entry(
        self, client_for: Any, document: Any, editor: Any, owner: Any
    ) -> None:
        """Coalescing is per person — it must not hide who else was working."""
        url = reverse("documents:detail", args=[document.id])
        client_for(editor).patch(url, {"content": "<p>Theirs.</p>"})
        client_for(owner).patch(url, {"content": "<p>Mine.</p>"})

        body = (
            client_for(owner)
            .get(LIST_URL, {"action": ActivityAction.DOCUMENT_EDITED})
            .json()
        )

        assert body["count"] == 2

    def test_restoring_a_version_is_recorded(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        version = document.versions.get()

        client_for(owner).post(
            reverse("documents:version-restore", args=[document.id, version.id])
        )

        entry = (
            client_for(owner)
            .get(LIST_URL, {"action": ActivityAction.DOCUMENT_EDITED})
            .json()["results"][0]
        )

        assert entry["context"] == "Restored version 1"

    def test_inviting_a_member_is_recorded(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        client_for(owner).post(
            reverse("workspaces:invite", args=[staffed_workspace.id]),
            {"email": outsider.email, "role": "editor"},
        )

        body = (
            client_for(owner)
            .get(LIST_URL, {"action": ActivityAction.MEMBER_INVITED})
            .json()
        )

        # Two from the staffed_workspace fixture, plus this one.
        assert body["count"] == 3
        assert body["results"][0]["target"]["name"] == outsider.name
        assert body["results"][0]["context"] == "editor"


class TestActivityMetadata:
    def test_an_entry_outlives_its_target(
        self, client_for: Any, staffed_workspace: Any, task: Any, owner: Any
    ) -> None:
        """
        The reason the target is a loose (type, id) pair with the name copied
        in. A foreign key would either block the delete or cascade the history
        away with it.
        """
        client_for(owner).delete(reverse("tasks:detail", args=[task.id]))

        entry = (
            client_for(owner)
            .get(LIST_URL, {"action": ActivityAction.TASK_CREATED})
            .json()["results"][0]
        )

        assert entry["target"]["name"] == "Implement Stripe API"
        assert entry["target"]["id"] == str(task.id)

    def test_an_entry_survives_its_actor(
        self, client_for: Any, staffed_workspace: Any, owner: Any, user_factory: Any
    ) -> None:
        """
        `actor` is SET_NULL so a departed account cannot pin the log in place,
        but the client types it as non-null — the copied name is what keeps the
        entry readable.
        """
        temp = user_factory(email="temp@streamsync.test", name="Temporary Person")
        entry = Activity.objects.create(
            workspace=staffed_workspace,
            actor=temp,
            action=ActivityAction.TASK_CREATED,
            entity_type=EntityType.TASK,
            entity_id=uuid.uuid4(),
            metadata={"name": "Some task", "actor_name": "Temporary Person"},
        )

        entry.actor = None
        Activity.objects.filter(pk=entry.pk).update(actor=None)

        rendered = client_for(owner).get(LIST_URL).json()["results"]
        match = next(e for e in rendered if e["id"] == str(entry.id))

        assert match["actor"]["id"] is None
        assert match["actor"]["name"] == "Temporary Person"

    def test_missing_context_serialises_as_null(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        entry = (
            client_for(owner)
            .get(LIST_URL, {"action": ActivityAction.DOCUMENT_CREATED})
            .json()["results"][0]
        )

        assert entry["context"] is None
