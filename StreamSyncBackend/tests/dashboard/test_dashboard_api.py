"""
The dashboard summary.

The counts are the reason this endpoint exists: a client cannot compute them
from a paginated list without being wrong, so the tests that matter most are
the ones that check the arithmetic over a set larger than one page.
"""

from datetime import timedelta
from typing import Any

import pytest
from django.utils import timezone

pytestmark = pytest.mark.django_db

URL = "/api/dashboard/"


def summary_for(client: Any, workspace: Any) -> dict:
    response = client.get(URL, {"workspace": str(workspace.id)})
    assert response.status_code == 200
    return response.json()


class TestCounts:
    def test_counts_cover_the_whole_workspace_not_one_page(
        self, client_for: Any, owner: Any, staffed_workspace: Any, project: Any
    ) -> None:
        """
        Thirty tasks, one page of twenty-five.

        This is the entire justification for the endpoint. A client summing the
        rows it holds would report 25.
        """
        from apps.tasks import services as task_services

        for index in range(30):
            task_services.create_task(
                workspace=staffed_workspace,
                project=project,
                creator=owner,
                title=f"Task {index}",
            )

        body = summary_for(client_for(owner), staffed_workspace)

        assert body["open_task_count"] == 30

    def test_done_tasks_are_not_open(
        self, client_for: Any, owner: Any, staffed_workspace: Any, project: Any
    ) -> None:
        from apps.tasks import services as task_services
        from apps.tasks.models import TaskStatus

        task = task_services.create_task(
            workspace=staffed_workspace, project=project, creator=owner, title="Ship it"
        )
        task_services.update_task(task=task, editor=owner, status=TaskStatus.DONE)

        body = summary_for(client_for(owner), staffed_workspace)

        assert body["open_task_count"] == 0
        assert body["completed_this_week_count"] == 1

    def test_overdue_tasks_count_as_due_today(
        self, client_for: Any, owner: Any, staffed_workspace: Any, project: Any
    ) -> None:
        """
        A deadline that has already passed is more urgent, not less.

        Hiding it would hide the thing the user most needs to see.
        """
        from apps.tasks import services as task_services

        task_services.create_task(
            workspace=staffed_workspace,
            project=project,
            creator=owner,
            title="Late",
            due_date=timezone.localdate() - timedelta(days=3),
        )
        task_services.create_task(
            workspace=staffed_workspace,
            project=project,
            creator=owner,
            title="Next month",
            due_date=timezone.localdate() + timedelta(days=30),
        )

        body = summary_for(client_for(owner), staffed_workspace)

        assert body["due_today_count"] == 1

    def test_finished_and_shelved_projects_are_not_counted_as_active(
        self, client_for: Any, owner: Any, staffed_workspace: Any, project: Any
    ) -> None:
        """
        "Active" means in flight, not the literal `active` status.

        The fixture project is in `planning`, and a team whose work is all still
        being planned does not have zero projects — a tile reading 0 above a
        list of three reads as a bug.
        """
        from apps.projects import services as project_services
        from apps.projects.models import ProjectStatus

        for status in (ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED):
            project_services.create_project(
                workspace=staffed_workspace,
                owner=owner,
                name=f"Finished {status}",
                status=status,
            )
        project_services.create_project(
            workspace=staffed_workspace,
            owner=owner,
            name="Running",
            status=ProjectStatus.ACTIVE,
        )

        body = summary_for(client_for(owner), staffed_workspace)

        # The planning fixture and the active one; not the archived or completed.
        assert body["active_project_count"] == 2

    def test_another_workspaces_rows_are_never_counted(
        self,
        client_for: Any,
        owner: Any,
        outsider: Any,
        staffed_workspace: Any,
        other_workspace: Any,
        other_project: Any,
    ) -> None:
        from apps.tasks import services as task_services

        for index in range(3):
            task_services.create_task(
                workspace=other_workspace,
                project=other_project,
                creator=outsider,
                title=f"Theirs {index}",
            )

        body = summary_for(client_for(owner), staffed_workspace)

        assert body["open_task_count"] == 0


class TestCollaborators:
    def test_recent_activity_reads_as_online(
        self, client_for: Any, owner: Any, staffed_workspace: Any, document: Any
    ) -> None:
        from apps.documents import services as document_services

        document_services.update_document(
            document=document, editor=owner, content="<p>Fresh edit.</p>"
        )

        body = summary_for(client_for(owner), staffed_workspace)
        me = next(
            entry
            for entry in body["collaborators"]
            if entry["user"]["id"] == str(owner.id)
        )

        assert me["status"] == "online"
        assert me["activity"] == f"Editing {document.title}"

    def test_a_member_who_has_done_nothing_is_offline(
        self, client_for: Any, owner: Any, viewer: Any, staffed_workspace: Any
    ) -> None:
        body = summary_for(client_for(owner), staffed_workspace)
        them = next(
            entry
            for entry in body["collaborators"]
            if entry["user"]["id"] == str(viewer.id)
        )

        assert them["status"] == "offline"
        assert them["activity"] is None

    def test_stale_activity_reads_as_idle(
        self,
        client_for: Any,
        owner: Any,
        editor: Any,
        staffed_workspace: Any,
        document: Any,
    ) -> None:
        """Between the two windows: around, but not on it right now."""
        from apps.activity.models import Activity
        from apps.documents import services as document_services

        document_services.update_document(
            document=document, editor=editor, content="<p>Older edit.</p>"
        )
        Activity.objects.filter(actor=editor).update(
            created_at=timezone.now() - timedelta(minutes=12)
        )

        body = summary_for(client_for(owner), staffed_workspace)
        them = next(
            entry
            for entry in body["collaborators"]
            if entry["user"]["id"] == str(editor.id)
        )

        assert them["status"] == "idle"

    def test_the_query_count_is_flat_in_the_number_of_members(
        self,
        client_for: Any,
        owner: Any,
        staffed_workspace: Any,
        user_factory: Any,
        django_assert_num_queries: Any,
        django_assert_max_num_queries: Any,
    ) -> None:
        """One query for everyone's latest action, not one per member."""
        from apps.workspaces import services as workspace_services
        from apps.workspaces.models import WorkspaceRole

        client = client_for(owner)
        with django_assert_max_num_queries(15) as baseline:
            client.get(URL, {"workspace": str(staffed_workspace.id)})

        for index in range(4):
            joiner = user_factory(name=f"Joiner {index}")
            workspace_services.invite_member(
                workspace=staffed_workspace,
                invited_by=owner,
                email=joiner.email,
                role=WorkspaceRole.EDITOR,
            )
            workspace_services.accept_invitation(
                workspace=staffed_workspace, user=joiner
            )

        with django_assert_num_queries(len(baseline.captured_queries)):
            client.get(URL, {"workspace": str(staffed_workspace.id)})


class TestAccess:
    def test_authentication_is_required(self, api_client: Any, workspace: Any) -> None:
        response = api_client.get(URL, {"workspace": str(workspace.id)})

        assert response.status_code == 401

    def test_a_workspace_the_caller_is_not_in_is_not_found(
        self, client_for: Any, outsider: Any, workspace: Any
    ) -> None:
        """404, not 403 — the same rule as every other workspace-scoped read."""
        response = client_for(outsider).get(URL, {"workspace": str(workspace.id)})

        assert response.status_code == 404

    def test_a_missing_workspace_parameter_is_not_found(
        self, client_for: Any, owner: Any
    ) -> None:
        assert client_for(owner).get(URL).status_code == 404
