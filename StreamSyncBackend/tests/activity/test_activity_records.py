"""
Activity records written by task and comment operations.

There is no read endpoint yet — the timeline is Milestone 6 — so these assert
against the table directly. What matters here is that entries are written for
the right events, carry enough context to render without their target, and
never take the operation down with them.
"""

from typing import Any

import pytest
from django.urls import reverse

from apps.activity.models import Activity, ActivityAction, EntityType

pytestmark = pytest.mark.django_db

TASKS_URL = reverse("tasks:list-create")
COMMENTS_URL = reverse("comments:list-create")


def entries(workspace, action: str | None = None):
    queryset = Activity.objects.filter(workspace=workspace)
    return queryset.filter(action=action) if action else queryset


class TestTaskActivity:
    def test_creating_a_task_records_it(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            TASKS_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "project_id": str(project.id),
                "title": "Implement Stripe API",
            },
        )

        entry = entries(staffed_workspace, ActivityAction.TASK_CREATED).get()

        assert entry.actor == owner
        assert entry.entity_type == EntityType.TASK
        assert str(entry.entity_id) == response.json()["id"]
        assert entry.metadata["name"] == "Implement Stripe API"
        assert entry.metadata["context"] == project.name
        assert entry.metadata["href"]

    def test_completing_a_task_records_it(
        self, client_for: Any, staffed_workspace: Any, task: Any, owner: Any
    ) -> None:
        client_for(owner).patch(
            reverse("tasks:detail", args=[task.id]), {"status": "done"}
        )

        entry = entries(staffed_workspace, ActivityAction.TASK_COMPLETED).get()

        assert entry.actor == owner
        assert str(entry.entity_id) == str(task.id)

    def test_completion_is_recorded_once_not_on_every_save(
        self, client_for: Any, staffed_workspace: Any, task: Any, owner: Any
    ) -> None:
        """A second PATCH to done is not a second completion."""
        client = client_for(owner)
        url = reverse("tasks:detail", args=[task.id])

        client.patch(url, {"status": "done"})
        client.patch(url, {"status": "done"})
        client.patch(url, {"priority": "high"})

        assert entries(staffed_workspace, ActivityAction.TASK_COMPLETED).count() == 1

    def test_reopening_then_completing_records_a_second_entry(
        self, client_for: Any, staffed_workspace: Any, task: Any, owner: Any
    ) -> None:
        """Genuinely finishing it twice is two events."""
        client = client_for(owner)
        url = reverse("tasks:detail", args=[task.id])

        client.patch(url, {"status": "done"})
        client.patch(url, {"status": "todo"})
        client.patch(url, {"status": "done"})

        assert entries(staffed_workspace, ActivityAction.TASK_COMPLETED).count() == 2

    def test_ordinary_edits_are_not_recorded(
        self, client_for: Any, staffed_workspace: Any, task: Any, owner: Any
    ) -> None:
        """Logging every field change would bury the events people look for."""
        client_for(owner).patch(
            reverse("tasks:detail", args=[task.id]),
            {"title": "Renamed", "priority": "urgent"},
        )

        assert not entries(staffed_workspace, ActivityAction.TASK_COMPLETED).exists()


class TestCommentActivity:
    def test_commenting_on_a_document_records_it(
        self, client_for: Any, staffed_workspace: Any, document: Any, owner: Any
    ) -> None:
        client_for(owner).post(
            COMMENTS_URL,
            {
                "resource_type": "document",
                "resource_id": str(document.id),
                "body": "Should we support Apple Pay?",
            },
        )

        entry = entries(staffed_workspace, ActivityAction.COMMENT_ADDED).get()

        assert entry.actor == owner
        assert entry.entity_type == EntityType.COMMENT
        # Named for the thing being discussed, which is what the feed shows.
        assert entry.metadata["name"] == document.title
        assert entry.metadata["context"] == "Should we support Apple Pay?"
        assert entry.metadata["resource_type"] == "document"

    def test_commenting_on_a_task_records_it(
        self, client_for: Any, staffed_workspace: Any, task: Any, owner: Any
    ) -> None:
        client_for(owner).post(
            COMMENTS_URL,
            {"resource_type": "task", "resource_id": str(task.id), "body": "Blocked."},
        )

        entry = entries(staffed_workspace, ActivityAction.COMMENT_ADDED).get()

        assert entry.metadata["name"] == task.title
        assert entry.metadata["resource_type"] == "task"

    def test_replying_records_it_too(
        self, client_for: Any, staffed_workspace: Any, comment: Any, editor: Any
    ) -> None:
        client_for(editor).post(
            reverse("comments:replies", args=[comment.id]), {"body": "Good idea."}
        )

        # One for the root (fixture) and one for the reply.
        added = entries(staffed_workspace, ActivityAction.COMMENT_ADDED)
        assert added.count() == 2
        assert added.filter(actor=editor).exists()

    def test_resolving_is_not_recorded(
        self, client_for: Any, staffed_workspace: Any, comment: Any, owner: Any
    ) -> None:
        """Not in the frontend's action vocabulary, so it would render blank."""
        before = entries(staffed_workspace).count()

        client_for(owner).patch(
            reverse("comments:detail", args=[comment.id]), {"resolved": True}
        )

        assert entries(staffed_workspace).count() == before


class TestActivityIntegrity:
    def test_records_are_append_only(
        self, comment: Any, staffed_workspace: Any
    ) -> None:
        """An audit trail that can be rewritten is not an audit trail."""
        entry = entries(staffed_workspace).first()
        entry.action = ActivityAction.AI_ACTION

        with pytest.raises(ValueError, match="append-only"):
            entry.save()

    def test_an_entry_survives_its_target(
        self, client_for: Any, staffed_workspace: Any, task: Any, owner: Any
    ) -> None:
        """
        The whole reason the target is a loose (type, id) pair with the name
        copied into metadata. "Raj deleted the task" is precisely the entry
        that must outlive the task.
        """
        client_for(owner).delete(reverse("tasks:detail", args=[task.id]))

        entry = entries(staffed_workspace, ActivityAction.TASK_CREATED).get()

        assert entry.metadata["name"] == "Implement Stripe API"

    def test_entries_are_scoped_to_their_workspace(
        self,
        client_for: Any,
        staffed_workspace: Any,
        other_workspace: Any,
        task: Any,
        other_task: Any,
    ) -> None:
        """
        Each workspace's timeline contains only its own events.

        Asserted by checking which objects the entries point at rather than by
        counting them: the number of entries a fixture produces changes
        whenever a new hook is added, but no hook should ever put one
        workspace's object in another's feed.
        """
        mine = entries(staffed_workspace)
        theirs = entries(other_workspace)

        assert mine.exists()
        assert theirs.exists()

        assert str(task.id) in [str(e.entity_id) for e in mine]
        assert str(other_task.id) not in [str(e.entity_id) for e in mine]
        assert str(task.id) not in [str(e.entity_id) for e in theirs]

    def test_a_logging_failure_does_not_lose_the_users_work(
        self,
        client_for: Any,
        staffed_workspace: Any,
        project: Any,
        owner: Any,
        monkeypatch: Any,
    ) -> None:
        """
        The savepoint inside `record()` is what makes this hold. Without it a
        failed insert would poison the enclosing transaction and take the task
        down with it.

        The failure is a real *database* error rather than a plain exception,
        because that is the case the savepoint exists for: a Python error would
        leave the transaction perfectly usable and the test would pass without
        proving anything.
        """
        from apps.activity.models import Activity as ActivityModel

        def explode(*args, **kwargs):
            from django.db import connection

            with connection.cursor() as cursor:
                cursor.execute("SELECT * FROM a_table_that_does_not_exist")

        monkeypatch.setattr(ActivityModel.objects, "create", explode)

        response = client_for(owner).post(
            TASKS_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "project_id": str(project.id),
                "title": "Survives logging failure",
            },
        )

        assert response.status_code == 201

        from apps.tasks.models import Task

        assert Task.objects.filter(title="Survives logging failure").exists()
