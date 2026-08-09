"""
Task CRUD, assignment, status, priority, filtering and permissions.

The role matrix and the cross-tenant cases carry the most weight, as they do
for every workspace-scoped resource.
"""

import uuid
from typing import Any

import pytest
from django.urls import reverse

from apps.tasks.models import Task, TaskPriority, TaskStatus

pytestmark = pytest.mark.django_db

LIST_URL = reverse("tasks:list-create")


def detail_url(task) -> str:
    return reverse("tasks:detail", args=[task.id])


def create_payload(workspace, project, **overrides) -> dict:
    return {
        "workspace_id": str(workspace.id),
        "project_id": str(project.id),
        "title": "Implement Stripe API",
        **overrides,
    }


class TestTaskCreation:
    def test_editor_can_create_a_task(
        self, client_for: Any, staffed_workspace: Any, project: Any, editor: Any
    ) -> None:
        response = client_for(editor).post(
            LIST_URL, create_payload(staffed_workspace, project)
        )

        assert response.status_code == 201

        body = response.json()
        assert body["title"] == "Implement Stripe API"
        assert body["project_id"] == str(project.id)
        assert body["project_name"] == project.name

    def test_viewer_cannot_create_a_task(
        self, client_for: Any, staffed_workspace: Any, project: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).post(
            LIST_URL, create_payload(staffed_workspace, project)
        )

        assert response.status_code == 403
        assert not Task.objects.exists()

    def test_non_member_cannot_create_a_task(
        self, client_for: Any, staffed_workspace: Any, project: Any, outsider: Any
    ) -> None:
        """404, not 403 — they must not learn the workspace exists."""
        response = client_for(outsider).post(
            LIST_URL, create_payload(staffed_workspace, project)
        )

        assert response.status_code == 404
        assert not Task.objects.exists()

    def test_defaults_are_todo_and_medium(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        body = (
            client_for(owner)
            .post(LIST_URL, create_payload(staffed_workspace, project))
            .json()
        )

        assert body["status"] == TaskStatus.TODO
        assert body["priority"] == TaskPriority.MEDIUM
        assert body["assignee"] is None
        assert body["due_date"] is None

    def test_creator_comes_from_the_session(
        self, client_for: Any, staffed_workspace: Any, project: Any, editor: Any
    ) -> None:
        response = client_for(editor).post(
            LIST_URL,
            create_payload(staffed_workspace, project, creator=str(uuid.uuid4())),
        )

        assert Task.objects.get(id=response.json()["id"]).creator == editor

    def test_accepts_every_status_and_priority(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        client = client_for(owner)

        for status in TaskStatus.values:
            for priority in TaskPriority.values:
                response = client.post(
                    LIST_URL,
                    create_payload(
                        staffed_workspace,
                        project,
                        title=f"{status}-{priority}",
                        status=status,
                        priority=priority,
                    ),
                )
                assert response.status_code == 201, (status, priority)
                assert response.json()["status"] == status
                assert response.json()["priority"] == priority

    def test_rejects_an_unknown_status(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL, create_payload(staffed_workspace, project, status="banana")
        )

        assert response.status_code == 400
        assert "status" in response.json()["error"]["details"]

    def test_rejects_a_blank_title(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL, create_payload(staffed_workspace, project, title="   ")
        )

        assert response.status_code == 400
        assert "title" in response.json()["error"]["details"]

    def test_cannot_use_a_project_from_another_workspace(
        self, client_for: Any, staffed_workspace: Any, other_project: Any, owner: Any
    ) -> None:
        """Would place a task from one tenant inside another's project."""
        response = client_for(owner).post(
            LIST_URL, create_payload(staffed_workspace, other_project)
        )

        assert response.status_code == 404
        assert not Task.objects.exists()

    def test_creating_in_done_records_completion(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL, create_payload(staffed_workspace, project, status="done")
        )

        assert Task.objects.get(id=response.json()["id"]).completed_at is not None

    def test_requires_authentication(
        self, api_client: Any, staffed_workspace: Any, project: Any
    ) -> None:
        response = api_client.post(LIST_URL, create_payload(staffed_workspace, project))

        assert response.status_code == 401


class TestTaskAssignment:
    def test_can_assign_to_a_workspace_member(
        self,
        client_for: Any,
        staffed_workspace: Any,
        project: Any,
        owner: Any,
        editor: Any,
    ) -> None:
        response = client_for(owner).post(
            LIST_URL,
            create_payload(staffed_workspace, project, assignee_id=str(editor.id)),
        )

        assert response.status_code == 201
        assert response.json()["assignee"]["id"] == str(editor.id)
        assert set(response.json()["assignee"]) == {"id", "name", "avatar_url"}

    def test_cannot_assign_to_a_non_member(
        self,
        client_for: Any,
        staffed_workspace: Any,
        project: Any,
        owner: Any,
        outsider: Any,
    ) -> None:
        """
        An assignee who cannot open the task is a silent dead end, and it
        would leak the task's existence outside the team. (README §16)
        """
        response = client_for(owner).post(
            LIST_URL,
            create_payload(staffed_workspace, project, assignee_id=str(outsider.id)),
        )

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "ASSIGNEE_NOT_A_MEMBER"
        assert not Task.objects.exists()

    def test_unknown_assignee_id_is_indistinguishable_from_a_non_member(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        """Otherwise assignment becomes an oracle for which user ids exist."""
        response = client_for(owner).post(
            LIST_URL,
            create_payload(staffed_workspace, project, assignee_id=str(uuid.uuid4())),
        )

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "ASSIGNEE_NOT_A_MEMBER"

    def test_can_reassign(
        self, client_for: Any, task: Any, owner: Any, editor: Any
    ) -> None:
        response = client_for(owner).patch(
            detail_url(task), {"assignee_id": str(editor.id)}
        )

        assert response.json()["assignee"]["id"] == str(editor.id)

    def test_can_unassign(
        self, client_for: Any, task: Any, owner: Any, editor: Any
    ) -> None:
        client = client_for(owner)
        client.patch(detail_url(task), {"assignee_id": str(editor.id)})

        response = client.patch(detail_url(task), {"assignee_id": None})

        assert response.json()["assignee"] is None

    def test_a_viewer_can_be_assigned(
        self,
        client_for: Any,
        staffed_workspace: Any,
        project: Any,
        owner: Any,
        viewer: Any,
    ) -> None:
        """
        Assignment is membership-based, not role-based. A viewer can be asked
        to review something even though they cannot edit it.
        """
        response = client_for(owner).post(
            LIST_URL,
            create_payload(staffed_workspace, project, assignee_id=str(viewer.id)),
        )

        assert response.status_code == 201


class TestTaskUpdate:
    def test_editor_can_change_status(
        self, client_for: Any, task: Any, editor: Any
    ) -> None:
        response = client_for(editor).patch(detail_url(task), {"status": "in_progress"})

        assert response.status_code == 200
        assert response.json()["status"] == "in_progress"

    def test_viewer_cannot_update(
        self, client_for: Any, task: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).patch(detail_url(task), {"status": "done"})

        assert response.status_code == 403
        task.refresh_from_db()
        assert task.status == TaskStatus.TODO

    def test_non_member_gets_404(
        self, client_for: Any, task: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).patch(detail_url(task), {"status": "done"})

        assert response.status_code == 404

    def test_partial_update_leaves_other_fields_alone(
        self, client_for: Any, task: Any, owner: Any
    ) -> None:
        """The board patches `status` alone on every drag."""
        response = client_for(owner).patch(detail_url(task), {"status": "review"})

        body = response.json()
        assert body["status"] == "review"
        assert body["title"] == "Implement Stripe API"
        assert body["priority"] == TaskPriority.MEDIUM

    def test_moving_to_done_records_completion(
        self, client_for: Any, task: Any, owner: Any
    ) -> None:
        client_for(owner).patch(detail_url(task), {"status": "done"})

        task.refresh_from_db()
        assert task.completed_at is not None

    def test_reopening_clears_completion(
        self, client_for: Any, task: Any, owner: Any
    ) -> None:
        """ "When was this finished?" must not report a completion that was undone."""
        client = client_for(owner)
        client.patch(detail_url(task), {"status": "done"})

        client.patch(detail_url(task), {"status": "todo"})

        task.refresh_from_db()
        assert task.completed_at is None

    def test_cannot_move_a_task_to_another_project(
        self, client_for: Any, task: Any, other_project: Any, owner: Any
    ) -> None:
        """`project_id` is not an accepted update field, so the key is ignored."""
        original = task.project_id

        client_for(owner).patch(detail_url(task), {"project_id": str(other_project.id)})

        task.refresh_from_db()
        assert task.project_id == original


class TestTaskListing:
    def test_lists_tasks_in_my_workspaces(
        self, client_for: Any, task: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).get(LIST_URL)

        assert response.status_code == 200
        assert [t["id"] for t in response.json()["results"]] == [str(task.id)]

    def test_excludes_tasks_from_other_workspaces(
        self, client_for: Any, task: Any, other_task: Any, viewer: Any
    ) -> None:
        """The core isolation guarantee for tasks."""
        ids = [t["id"] for t in client_for(viewer).get(LIST_URL).json()["results"]]

        assert ids == [str(task.id)]
        assert str(other_task.id) not in ids

    def test_is_paginated(self, client_for: Any, task: Any, owner: Any) -> None:
        body = client_for(owner).get(LIST_URL).json()

        assert {"count", "page", "page_size", "total_pages", "results"} <= set(body)

    def test_labels_are_empty(self, client_for: Any, task: Any, owner: Any) -> None:
        """No label catalogue exists yet; the key is present so the UI renders."""
        assert client_for(owner).get(LIST_URL).json()["results"][0]["labels"] == []

    def test_comment_count_reflects_threads_not_replies(
        self, client_for: Any, task: Any, task_comment: Any, owner: Any, editor: Any
    ) -> None:
        """A thread with replies is one conversation, which is what the badge means."""
        from apps.comments import services

        services.reply_to_comment(parent=task_comment, author=owner, body="On it.")

        body = client_for(owner).get(LIST_URL).json()["results"][0]

        assert body["comment_count"] == 1


class TestTaskFiltering:
    def test_filters_by_status(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        client.post(LIST_URL, create_payload(staffed_workspace, project, title="A"))
        client.post(
            LIST_URL,
            create_payload(staffed_workspace, project, title="B", status="done"),
        )

        body = client.get(LIST_URL, {"status": "done"}).json()

        assert body["count"] == 1
        assert body["results"][0]["title"] == "B"

    def test_filters_by_priority(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        client.post(
            LIST_URL,
            create_payload(staffed_workspace, project, title="Hot", priority="urgent"),
        )
        client.post(LIST_URL, create_payload(staffed_workspace, project, title="Cold"))

        body = client.get(LIST_URL, {"priority": "urgent"}).json()

        assert body["count"] == 1
        assert body["results"][0]["title"] == "Hot"

    def test_filters_by_project(
        self, client_for: Any, task: Any, project: Any, owner: Any
    ) -> None:
        body = client_for(owner).get(LIST_URL, {"project": str(project.id)}).json()

        assert body["count"] == 1

    def test_filters_by_assignee(
        self,
        client_for: Any,
        staffed_workspace: Any,
        project: Any,
        owner: Any,
        editor: Any,
    ) -> None:
        client = client_for(owner)
        client.post(
            LIST_URL,
            create_payload(
                staffed_workspace, project, title="Theirs", assignee_id=str(editor.id)
            ),
        )
        client.post(
            LIST_URL, create_payload(staffed_workspace, project, title="Nobody")
        )

        body = client.get(LIST_URL, {"assignee": str(editor.id)}).json()

        assert body["count"] == 1
        assert body["results"][0]["title"] == "Theirs"

    def test_filters_by_unassigned(
        self,
        client_for: Any,
        staffed_workspace: Any,
        project: Any,
        owner: Any,
        editor: Any,
    ) -> None:
        client = client_for(owner)
        client.post(
            LIST_URL,
            create_payload(
                staffed_workspace, project, title="Theirs", assignee_id=str(editor.id)
            ),
        )
        client.post(
            LIST_URL, create_payload(staffed_workspace, project, title="Nobody")
        )

        body = client.get(LIST_URL, {"assignee": "none"}).json()

        assert body["count"] == 1
        assert body["results"][0]["title"] == "Nobody"

    def test_filters_by_my_tasks(
        self,
        client_for: Any,
        staffed_workspace: Any,
        project: Any,
        owner: Any,
        editor: Any,
    ) -> None:
        client = client_for(owner)
        client.post(
            LIST_URL,
            create_payload(
                staffed_workspace, project, title="Mine", assignee_id=str(owner.id)
            ),
        )
        client.post(
            LIST_URL,
            create_payload(
                staffed_workspace, project, title="Theirs", assignee_id=str(editor.id)
            ),
        )

        body = client.get(LIST_URL, {"assignee": "me"}).json()

        assert body["count"] == 1
        assert body["results"][0]["title"] == "Mine"

    def test_search_matches_title_and_description(
        self, client_for: Any, task: Any, owner: Any
    ) -> None:
        client = client_for(owner)

        assert client.get(LIST_URL, {"search": "stripe"}).json()["count"] == 1
        assert client.get(LIST_URL, {"search": "payment intent"}).json()["count"] == 1
        assert client.get(LIST_URL, {"search": "kangaroo"}).json()["count"] == 0

    def test_search_cannot_reach_another_workspace(
        self, client_for: Any, task: Any, other_task: Any, owner: Any
    ) -> None:
        assert client_for(owner).get(LIST_URL, {"search": "Rival"}).json()["count"] == 0

    def test_unsupported_ordering_falls_back(
        self, client_for: Any, task: Any, owner: Any
    ) -> None:
        response = client_for(owner).get(LIST_URL, {"ordering": "creator__password"})

        assert response.status_code == 200
        assert response.json()["count"] == 1


class TestTaskDetailAndDelete:
    def test_member_can_read_it(self, client_for: Any, task: Any, viewer: Any) -> None:
        response = client_for(viewer).get(detail_url(task))

        assert response.status_code == 200
        assert response.json()["id"] == str(task.id)

    def test_non_member_gets_404(
        self, client_for: Any, task: Any, outsider: Any
    ) -> None:
        assert client_for(outsider).get(detail_url(task)).status_code == 404

    def test_cannot_read_a_task_in_another_workspace(
        self, client_for: Any, other_task: Any, owner: Any
    ) -> None:
        assert client_for(owner).get(detail_url(other_task)).status_code == 404

    def test_editor_can_delete(self, client_for: Any, task: Any, editor: Any) -> None:
        response = client_for(editor).delete(detail_url(task))

        assert response.status_code == 204
        assert not Task.objects.filter(id=task.id).exists()

    def test_viewer_cannot_delete(
        self, client_for: Any, task: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).delete(detail_url(task))

        assert response.status_code == 403
        assert Task.objects.filter(id=task.id).exists()

    def test_deleting_a_task_removes_its_comments(
        self, client_for: Any, task: Any, task_comment: Any, owner: Any
    ) -> None:
        from apps.comments.models import Comment

        client_for(owner).delete(detail_url(task))

        assert not Comment.objects.filter(task_id=task.id).exists()

    def test_deleting_a_project_removes_its_tasks(
        self, client_for: Any, task: Any, project: Any, owner: Any
    ) -> None:
        """
        A task is a unit of work *within* a project and means nothing without
        it — the opposite of a document, which outlives its project.
        """
        client_for(owner).delete(reverse("projects:detail", args=[project.id]))

        assert not Task.objects.filter(id=task.id).exists()


class TestProjectTaskCounts:
    def test_project_reports_its_task_counts(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        """These were constant zeros until the Task model existed."""
        client = client_for(owner)
        client.post(LIST_URL, create_payload(staffed_workspace, project, title="A"))
        client.post(
            LIST_URL,
            create_payload(staffed_workspace, project, title="B", status="done"),
        )

        body = client.get(reverse("projects:list-create")).json()["results"][0]

        assert body["task_count"] == 2
        assert body["completed_task_count"] == 1

    def test_counts_are_zero_for_an_empty_project(
        self, client_for: Any, project: Any, owner: Any
    ) -> None:
        body = (
            client_for(owner).get(reverse("projects:list-create")).json()["results"][0]
        )

        assert body["task_count"] == 0
        assert body["completed_task_count"] == 0
