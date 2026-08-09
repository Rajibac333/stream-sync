"""
Workspace creation, listing, detail and isolation.

Isolation is the property this milestone exists to establish, so the outsider
cases are as important as the happy paths: a bug that leaks another team's
workspace is worse than one that blocks a legitimate member.
"""

from typing import Any

import pytest
from django.urls import reverse

from apps.workspaces.models import (
    MembershipStatus,
    Workspace,
    WorkspaceMembership,
    WorkspaceRole,
)

pytestmark = pytest.mark.django_db

LIST_URL = reverse("workspaces:list-create")


def detail_url(workspace) -> str:
    return reverse("workspaces:detail", args=[workspace.id])


class TestWorkspaceCreation:
    def test_creates_a_workspace(self, client_for: Any, owner: Any) -> None:
        response = client_for(owner).post(
            LIST_URL, {"name": "EverTech", "description": "Product team"}
        )

        assert response.status_code == 201

        body = response.json()
        assert body["name"] == "EverTech"
        assert body["description"] == "Product team"
        assert body["slug"] == "evertech"

    def test_creator_becomes_the_owner(self, client_for: Any, owner: Any) -> None:
        """
        The membership is what grants access; the `owner` column alone would
        leave the creator unable to see their own workspace. (README §21)
        """
        response = client_for(owner).post(LIST_URL, {"name": "EverTech"})

        workspace = Workspace.objects.get(id=response.json()["id"])
        membership = WorkspaceMembership.objects.get(workspace=workspace, user=owner)

        assert workspace.owner == owner
        assert membership.role == WorkspaceRole.OWNER
        assert membership.status == MembershipStatus.ACTIVE
        assert membership.joined_at is not None

    def test_response_reports_the_creators_role_and_member_count(
        self, client_for: Any, owner: Any
    ) -> None:
        body = client_for(owner).post(LIST_URL, {"name": "EverTech"}).json()

        assert body["role"] == "owner"
        assert body["member_count"] == 1

    def test_description_is_optional(self, client_for: Any, owner: Any) -> None:
        """Absent description serialises as null, not an empty string."""
        response = client_for(owner).post(LIST_URL, {"name": "EverTech"})

        assert response.status_code == 201
        assert response.json()["description"] is None

    def test_slug_collisions_get_a_suffix(self, client_for: Any, owner: Any) -> None:
        client = client_for(owner)

        first = client.post(LIST_URL, {"name": "EverTech"}).json()
        second = client.post(LIST_URL, {"name": "EverTech"}).json()

        assert first["slug"] == "evertech"
        assert second["slug"].startswith("evertech-")
        assert first["slug"] != second["slug"]

    def test_rejects_a_blank_name(self, client_for: Any, owner: Any) -> None:
        response = client_for(owner).post(LIST_URL, {"name": "   "})

        assert response.status_code == 400
        assert "name" in response.json()["error"]["details"]

    def test_cannot_create_a_workspace_owned_by_someone_else(
        self, client_for: Any, owner: Any, outsider: Any
    ) -> None:
        """`owner` is not an accepted input, so the extra key is ignored."""
        response = client_for(owner).post(
            LIST_URL, {"name": "EverTech", "owner": str(outsider.id)}
        )

        assert response.status_code == 201
        assert Workspace.objects.get(id=response.json()["id"]).owner == owner

    def test_requires_authentication(self, api_client: Any) -> None:
        response = api_client.post(LIST_URL, {"name": "EverTech"})

        assert response.status_code == 401


class TestWorkspaceList:
    def test_lists_workspaces_the_user_belongs_to(
        self, client_for: Any, staffed_workspace: Any, editor: Any
    ) -> None:
        response = client_for(editor).get(LIST_URL)

        assert response.status_code == 200
        assert [w["id"] for w in response.json()["results"]] == [
            str(staffed_workspace.id)
        ]

    def test_reports_each_users_own_role(
        self, client_for: Any, staffed_workspace: Any, owner: Any, viewer: Any
    ) -> None:
        """The same workspace, two callers, two different `role` values."""
        as_owner = client_for(owner).get(LIST_URL).json()["results"][0]
        as_viewer = client_for(viewer).get(LIST_URL).json()["results"][0]

        assert as_owner["id"] == as_viewer["id"]
        assert as_owner["role"] == "owner"
        assert as_viewer["role"] == "viewer"

    def test_member_count_includes_pending_invitations(
        self, client_for: Any, workspace: Any, owner: Any, outsider: Any
    ) -> None:
        """An invited person occupies a seat, so they are counted."""
        from apps.workspaces import services

        services.invite_member(
            workspace=workspace,
            invited_by=owner,
            email=outsider.email,
            role=WorkspaceRole.VIEWER,
        )

        body = client_for(owner).get(LIST_URL).json()["results"][0]

        assert body["member_count"] == 2

    def test_excludes_workspaces_the_user_does_not_belong_to(
        self, client_for: Any, staffed_workspace: Any, outsider: Any
    ) -> None:
        """The core isolation guarantee, at the list level."""
        response = client_for(outsider).get(LIST_URL)

        assert response.status_code == 200
        assert response.json()["results"] == []

    def test_excludes_workspaces_with_only_a_pending_invitation(
        self, client_for: Any, workspace: Any, owner: Any, outsider: Any
    ) -> None:
        """An unaccepted invitation must not put a workspace in the switcher."""
        from apps.workspaces import services

        services.invite_member(
            workspace=workspace,
            invited_by=owner,
            email=outsider.email,
            role=WorkspaceRole.VIEWER,
        )

        assert client_for(outsider).get(LIST_URL).json()["results"] == []

    def test_is_paginated(self, client_for: Any, owner: Any) -> None:
        client = client_for(owner)
        for index in range(3):
            client.post(LIST_URL, {"name": f"Workspace {index}"})

        body = client.get(LIST_URL).json()

        assert body["count"] == 3
        assert {"count", "page", "page_size", "results"} <= set(body)

    def test_requires_authentication(self, api_client: Any) -> None:
        assert api_client.get(LIST_URL).status_code == 401


class TestWorkspaceDetail:
    def test_member_can_read_it(
        self, client_for: Any, staffed_workspace: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).get(detail_url(staffed_workspace))

        assert response.status_code == 200
        assert response.json()["id"] == str(staffed_workspace.id)
        assert response.json()["role"] == "viewer"

    def test_non_member_gets_404_not_403(
        self, client_for: Any, staffed_workspace: Any, outsider: Any
    ) -> None:
        """
        404 rather than 403 on purpose. A 403 confirms the workspace exists,
        which lets an attacker enumerate ids and learn about teams they have
        no relationship with. (README §16)
        """
        response = client_for(outsider).get(detail_url(staffed_workspace))

        assert response.status_code == 404

    def test_pending_invitee_cannot_read_it(
        self, client_for: Any, workspace: Any, owner: Any, outsider: Any
    ) -> None:
        """An invitation reserves a seat; it does not grant access."""
        from apps.workspaces import services

        services.invite_member(
            workspace=workspace,
            invited_by=owner,
            email=outsider.email,
            role=WorkspaceRole.EDITOR,
        )

        assert client_for(outsider).get(detail_url(workspace)).status_code == 404

    def test_unknown_workspace_is_404(self, client_for: Any, owner: Any) -> None:
        import uuid

        url = reverse("workspaces:detail", args=[uuid.uuid4()])

        assert client_for(owner).get(url).status_code == 404

    def test_requires_authentication(self, api_client: Any, workspace: Any) -> None:
        assert api_client.get(detail_url(workspace)).status_code == 401


class TestWorkspaceUpdate:
    def test_owner_can_rename(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).patch(
            detail_url(staffed_workspace), {"name": "EverTech Renamed"}
        )

        assert response.status_code == 200
        assert response.json()["name"] == "EverTech Renamed"

    def test_renaming_does_not_change_the_slug(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        """A changing slug would break every existing link and bookmark."""
        original = staffed_workspace.slug

        response = client_for(owner).patch(
            detail_url(staffed_workspace), {"name": "Something Else Entirely"}
        )

        assert response.json()["slug"] == original

    def test_editor_cannot_rename(
        self, client_for: Any, staffed_workspace: Any, editor: Any
    ) -> None:
        response = client_for(editor).patch(
            detail_url(staffed_workspace), {"name": "Hijacked"}
        )

        assert response.status_code == 403
        staffed_workspace.refresh_from_db()
        assert staffed_workspace.name == "EverTech"

    def test_viewer_cannot_rename(
        self, client_for: Any, staffed_workspace: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).patch(
            detail_url(staffed_workspace), {"name": "Hijacked"}
        )

        assert response.status_code == 403

    def test_non_member_gets_404(
        self, client_for: Any, staffed_workspace: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).patch(
            detail_url(staffed_workspace), {"name": "Hijacked"}
        )

        assert response.status_code == 404


class TestWorkspaceDelete:
    def test_owner_can_delete(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).delete(detail_url(staffed_workspace))

        assert response.status_code == 204
        assert not Workspace.objects.filter(id=staffed_workspace.id).exists()

    def test_deleting_removes_its_memberships(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        client_for(owner).delete(detail_url(staffed_workspace))

        assert not WorkspaceMembership.objects.filter(
            workspace_id=staffed_workspace.id
        ).exists()

    def test_editor_cannot_delete(
        self, client_for: Any, staffed_workspace: Any, editor: Any
    ) -> None:
        response = client_for(editor).delete(detail_url(staffed_workspace))

        assert response.status_code == 403
        assert Workspace.objects.filter(id=staffed_workspace.id).exists()

    def test_non_member_cannot_delete(
        self, client_for: Any, staffed_workspace: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).delete(detail_url(staffed_workspace))

        assert response.status_code == 404
        assert Workspace.objects.filter(id=staffed_workspace.id).exists()
