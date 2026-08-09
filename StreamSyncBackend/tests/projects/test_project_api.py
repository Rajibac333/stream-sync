"""
Project CRUD, permissions, filtering and search.

The role matrix and the cross-workspace cases carry the most weight: a project
leaking between tenants is the worst failure this milestone can produce.
"""

import uuid
from typing import Any

import pytest
from django.urls import reverse

from apps.projects.models import Project, ProjectStatus

pytestmark = pytest.mark.django_db

LIST_URL = reverse("projects:list-create")


def detail_url(project) -> str:
    return reverse("projects:detail", args=[project.id])


class TestProjectCreation:
    def test_editor_can_create_a_project(
        self, client_for: Any, staffed_workspace: Any, editor: Any
    ) -> None:
        response = client_for(editor).post(
            LIST_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "name": "Checkout Revamp",
                "description": "Stripe and Apple Pay",
                "status": "active",
            },
        )

        assert response.status_code == 201

        body = response.json()
        assert body["name"] == "Checkout Revamp"
        assert body["status"] == "active"
        assert body["workspace_id"] == str(staffed_workspace.id)

    def test_owner_can_create_a_project(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "name": "Roadmap"}
        )

        assert response.status_code == 201

    def test_viewer_cannot_create_a_project(
        self, client_for: Any, staffed_workspace: Any, viewer: Any
    ) -> None:
        """Viewers are read-only. That is the entire point of the role."""
        response = client_for(viewer).post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "name": "Roadmap"}
        )

        assert response.status_code == 403
        assert not Project.objects.exists()

    def test_non_member_cannot_create_a_project(
        self, client_for: Any, staffed_workspace: Any, outsider: Any
    ) -> None:
        """404, not 403 — they should not learn the workspace exists."""
        response = client_for(outsider).post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "name": "Intrusion"}
        )

        assert response.status_code == 404
        assert not Project.objects.exists()

    def test_creator_becomes_the_owner(
        self, client_for: Any, staffed_workspace: Any, editor: Any
    ) -> None:
        """Taken from the session, never the body."""
        response = client_for(editor).post(
            LIST_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "name": "Roadmap",
                "owner": str(uuid.uuid4()),
            },
        )

        assert Project.objects.get(id=response.json()["id"]).owner == editor

    def test_status_defaults_to_planning(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "name": "Roadmap"}
        )

        assert response.json()["status"] == ProjectStatus.PLANNING

    def test_slug_is_unique_within_the_workspace(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        payload = {"workspace_id": str(staffed_workspace.id), "name": "Roadmap"}

        first = client.post(LIST_URL, payload).json()
        second = client.post(LIST_URL, payload).json()

        assert first["slug"] == "roadmap"
        assert second["slug"].startswith("roadmap-")

    def test_same_slug_may_exist_in_two_workspaces(
        self,
        client_for: Any,
        staffed_workspace: Any,
        owner: Any,
        other_workspace: Any,
        outsider: Any,
    ) -> None:
        """Uniqueness is per workspace, so two teams may both have a "Roadmap"."""
        mine = client_for(owner).post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "name": "Roadmap"}
        )
        theirs = client_for(outsider).post(
            LIST_URL, {"workspace_id": str(other_workspace.id), "name": "Roadmap"}
        )

        assert mine.json()["slug"] == "roadmap"
        assert theirs.json()["slug"] == "roadmap"

    def test_rejects_a_blank_name(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "name": "  "}
        )

        assert response.status_code == 400
        assert "name" in response.json()["error"]["details"]

    def test_rejects_an_unknown_status(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "name": "Roadmap",
                "status": "not_a_status",
            },
        )

        assert response.status_code == 400

    def test_requires_authentication(
        self, api_client: Any, staffed_workspace: Any
    ) -> None:
        response = api_client.post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "name": "Roadmap"}
        )

        assert response.status_code == 401


class TestProjectListing:
    def test_lists_projects_in_my_workspaces(
        self, client_for: Any, project: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).get(LIST_URL)

        assert response.status_code == 200
        assert [p["id"] for p in response.json()["results"]] == [str(project.id)]

    def test_excludes_projects_from_other_workspaces(
        self, client_for: Any, project: Any, other_project: Any, viewer: Any
    ) -> None:
        """The core isolation guarantee for projects."""
        ids = [p["id"] for p in client_for(viewer).get(LIST_URL).json()["results"]]

        assert ids == [str(project.id)]
        assert str(other_project.id) not in ids

    def test_includes_workspace_members(
        self, client_for: Any, project: Any, owner: Any
    ) -> None:
        """Access to a project is access to its workspace, so those are its members."""
        body = client_for(owner).get(LIST_URL).json()["results"][0]

        assert len(body["members"]) == 3
        assert set(body["members"][0]) == {"id", "name", "avatar_url"}

    def test_task_counts_are_zero_until_tasks_exist(
        self, client_for: Any, project: Any, owner: Any
    ) -> None:
        """No Task model yet, so zero is accurate rather than a placeholder."""
        body = client_for(owner).get(LIST_URL).json()["results"][0]

        assert body["task_count"] == 0
        assert body["completed_task_count"] == 0

    def test_is_paginated(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        for index in range(3):
            client.post(
                LIST_URL,
                {"workspace_id": str(staffed_workspace.id), "name": f"Project {index}"},
            )

        body = client.get(LIST_URL).json()

        assert body["count"] == 3
        assert {"count", "page", "page_size", "total_pages", "results"} <= set(body)

    def test_requires_authentication(self, api_client: Any) -> None:
        assert api_client.get(LIST_URL).status_code == 401


class TestProjectFiltering:
    def test_filters_by_workspace(
        self, client_for: Any, project: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).get(
            LIST_URL, {"workspace": str(staffed_workspace.id)}
        )

        assert [p["id"] for p in response.json()["results"]] == [str(project.id)]

    def test_filtering_by_someone_elses_workspace_returns_nothing(
        self, client_for: Any, project: Any, other_workspace: Any, owner: Any
    ) -> None:
        """
        A workspace id the caller cannot see matches nothing rather than
        leaking. The scoping happens before the filter, so the parameter can
        never widen access.
        """
        response = client_for(owner).get(
            LIST_URL, {"workspace": str(other_workspace.id)}
        )

        assert response.status_code == 200
        assert response.json()["results"] == []

    def test_filters_by_status(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        base = {"workspace_id": str(staffed_workspace.id)}
        client.post(LIST_URL, {**base, "name": "Live", "status": "active"})
        client.post(LIST_URL, {**base, "name": "Later", "status": "planning"})

        body = client.get(LIST_URL, {"status": "active"}).json()

        assert body["count"] == 1
        assert body["results"][0]["name"] == "Live"

    def test_unknown_status_filter_is_ignored(
        self, client_for: Any, project: Any, owner: Any
    ) -> None:
        """An invalid filter must not silently return everything *or* error."""
        body = client_for(owner).get(LIST_URL, {"status": "nonsense"}).json()

        assert body["count"] == 1

    def test_orders_by_the_requested_field(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        base = {"workspace_id": str(staffed_workspace.id)}
        client.post(LIST_URL, {**base, "name": "Zebra"})
        client.post(LIST_URL, {**base, "name": "Alpha"})

        body = client.get(LIST_URL, {"ordering": "name"}).json()

        assert [p["name"] for p in body["results"]] == ["Alpha", "Zebra"]

    def test_unsupported_ordering_falls_back_to_the_default(
        self, client_for: Any, project: Any, owner: Any
    ) -> None:
        """An open ordering parameter would let a caller sort by any column."""
        response = client_for(owner).get(LIST_URL, {"ordering": "owner__password"})

        assert response.status_code == 200
        assert response.json()["count"] == 1


class TestProjectSearch:
    def test_matches_the_name(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        base = {"workspace_id": str(staffed_workspace.id)}
        client.post(LIST_URL, {**base, "name": "Checkout Revamp"})
        client.post(LIST_URL, {**base, "name": "Marketing Site"})

        body = client.get(LIST_URL, {"search": "checkout"}).json()

        assert body["count"] == 1
        assert body["results"][0]["name"] == "Checkout Revamp"

    def test_matches_the_description(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        client.post(
            LIST_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "name": "Payments",
                "description": "Integrate Stripe billing",
            },
        )

        assert client.get(LIST_URL, {"search": "stripe"}).json()["count"] == 1

    def test_search_is_case_insensitive(
        self, client_for: Any, project: Any, owner: Any
    ) -> None:
        assert (
            client_for(owner).get(LIST_URL, {"search": "CHECKOUT"}).json()["count"] == 1
        )

    def test_search_cannot_reach_another_workspace(
        self, client_for: Any, project: Any, other_project: Any, owner: Any
    ) -> None:
        """Search runs inside the scoped queryset, never across it."""
        body = client_for(owner).get(LIST_URL, {"search": "Rival"}).json()

        assert body["count"] == 0


class TestProjectDetail:
    def test_member_can_read_it(
        self, client_for: Any, project: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).get(detail_url(project))

        assert response.status_code == 200
        assert response.json()["id"] == str(project.id)

    def test_non_member_gets_404(
        self, client_for: Any, project: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).get(detail_url(project))

        assert response.status_code == 404

    def test_cannot_read_a_project_in_another_workspace(
        self, client_for: Any, other_project: Any, owner: Any
    ) -> None:
        assert client_for(owner).get(detail_url(other_project)).status_code == 404

    def test_unknown_project_is_404(self, client_for: Any, owner: Any) -> None:
        url = reverse("projects:detail", args=[uuid.uuid4()])

        assert client_for(owner).get(url).status_code == 404


class TestProjectUpdate:
    def test_editor_can_update(
        self, client_for: Any, project: Any, editor: Any
    ) -> None:
        response = client_for(editor).patch(
            detail_url(project), {"name": "Checkout v2", "status": "completed"}
        )

        assert response.status_code == 200
        assert response.json()["name"] == "Checkout v2"
        assert response.json()["status"] == "completed"

    def test_viewer_cannot_update(
        self, client_for: Any, project: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).patch(detail_url(project), {"name": "Hijacked"})

        assert response.status_code == 403
        project.refresh_from_db()
        assert project.name == "Checkout Revamp"

    def test_non_member_gets_404(
        self, client_for: Any, project: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).patch(detail_url(project), {"name": "Hijacked"})

        assert response.status_code == 404

    def test_renaming_does_not_change_the_slug(
        self, client_for: Any, project: Any, owner: Any
    ) -> None:
        original = project.slug

        response = client_for(owner).patch(detail_url(project), {"name": "Totally New"})

        assert response.json()["slug"] == original

    def test_cannot_move_a_project_to_another_workspace(
        self, client_for: Any, project: Any, other_workspace: Any, owner: Any
    ) -> None:
        """
        Moving a project across a tenant boundary would carry its documents
        with it. The field is not accepted, so the key is ignored.
        """
        client_for(owner).patch(
            detail_url(project), {"workspace_id": str(other_workspace.id)}
        )

        project.refresh_from_db()
        assert project.workspace_id != other_workspace.id


class TestProjectDelete:
    def test_workspace_owner_can_delete(
        self, client_for: Any, project: Any, owner: Any
    ) -> None:
        response = client_for(owner).delete(detail_url(project))

        assert response.status_code == 204
        assert not Project.objects.filter(id=project.id).exists()

    def test_editor_cannot_delete(
        self, client_for: Any, project: Any, editor: Any
    ) -> None:
        """Deleting a project destroys shared work; that stays with the owner."""
        response = client_for(editor).delete(detail_url(project))

        assert response.status_code == 403
        assert Project.objects.filter(id=project.id).exists()

    def test_non_member_gets_404(
        self, client_for: Any, project: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).delete(detail_url(project))

        assert response.status_code == 404
        assert Project.objects.filter(id=project.id).exists()
