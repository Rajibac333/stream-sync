"""
Member listing, invitations and role changes.

The role matrix is asserted explicitly — owner, editor, viewer and outsider
against each action — because "who may do what" is the whole point of this
milestone and is the easiest thing to regress silently.
"""

import uuid
from typing import Any

import pytest
from django.urls import reverse

from apps.workspaces.models import (
    MembershipStatus,
    WorkspaceMembership,
    WorkspaceRole,
)

pytestmark = pytest.mark.django_db


def members_url(workspace) -> str:
    return reverse("workspaces:members", args=[workspace.id])


def invite_url(workspace) -> str:
    return reverse("workspaces:invite", args=[workspace.id])


def member_url(workspace, membership) -> str:
    return reverse("workspaces:member-detail", args=[workspace.id, membership.id])


def membership_of(workspace, user) -> WorkspaceMembership:
    return WorkspaceMembership.objects.get(workspace=workspace, user=user)


class TestMemberListing:
    def test_owner_can_list_members(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).get(members_url(staffed_workspace))

        assert response.status_code == 200
        assert response.json()["count"] == 3

    def test_every_member_role_can_read_the_list(
        self,
        client_for: Any,
        staffed_workspace: Any,
        owner: Any,
        editor: Any,
        viewer: Any,
    ) -> None:
        """Seeing who is on the team is not a privileged action."""
        for member in (owner, editor, viewer):
            response = client_for(member).get(members_url(staffed_workspace))
            assert response.status_code == 200, member.email

    def test_entries_carry_the_user_role_and_status(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        body = client_for(owner).get(members_url(staffed_workspace)).json()

        by_email = {row["user"]["email"]: row for row in body["results"]}

        assert by_email["owner@streamsync.test"]["role"] == "owner"
        assert by_email["editor@streamsync.test"]["role"] == "editor"
        assert by_email["viewer@streamsync.test"]["status"] == "active"
        assert by_email["viewer@streamsync.test"]["joined_at"]

    def test_pending_invitations_appear_with_invited_status(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        client_for(owner).post(
            invite_url(staffed_workspace),
            {"email": outsider.email, "role": "editor"},
        )

        body = client_for(owner).get(members_url(staffed_workspace)).json()
        invited = [row for row in body["results"] if row["status"] == "invited"]

        assert len(invited) == 1
        assert invited[0]["user"]["email"] == outsider.email
        # Never null, so the client can always render a date column.
        assert invited[0]["joined_at"]

    def test_non_member_cannot_list_members(
        self, client_for: Any, staffed_workspace: Any, outsider: Any
    ) -> None:
        """Team rosters of workspaces you do not belong to stay invisible."""
        response = client_for(outsider).get(members_url(staffed_workspace))

        assert response.status_code == 404

    def test_requires_authentication(self, api_client: Any, workspace: Any) -> None:
        assert api_client.get(members_url(workspace)).status_code == 401


class TestInvitations:
    def test_owner_can_invite(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        response = client_for(owner).post(
            invite_url(staffed_workspace),
            {"email": outsider.email, "role": "editor"},
        )

        assert response.status_code == 201

        body = response.json()
        assert body["user"]["email"] == outsider.email
        assert body["role"] == "editor"
        assert body["status"] == "invited"

    def test_invitation_records_who_sent_it(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        """Taken from the session — a client cannot attribute it to someone else."""
        client_for(owner).post(
            invite_url(staffed_workspace), {"email": outsider.email, "role": "viewer"}
        )

        assert membership_of(staffed_workspace, outsider).invited_by == owner

    def test_role_defaults_to_viewer(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        """The least-privileged default, so an omitted role cannot over-grant."""
        response = client_for(owner).post(
            invite_url(staffed_workspace), {"email": outsider.email}
        )

        assert response.json()["role"] == "viewer"

    def test_invitation_email_is_case_insensitive(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        response = client_for(owner).post(
            invite_url(staffed_workspace),
            {"email": outsider.email.upper(), "role": "viewer"},
        )

        assert response.status_code == 201
        assert response.json()["user"]["id"] == str(outsider.id)

    def test_editor_cannot_invite(
        self, client_for: Any, staffed_workspace: Any, editor: Any, outsider: Any
    ) -> None:
        """
        An editor who could invite could invite themselves a second account
        and escalate, which would make the owner role meaningless.
        """
        response = client_for(editor).post(
            invite_url(staffed_workspace),
            {"email": outsider.email, "role": "editor"},
        )

        assert response.status_code == 403
        assert not WorkspaceMembership.objects.filter(
            workspace=staffed_workspace, user=outsider
        ).exists()

    def test_viewer_cannot_invite(
        self, client_for: Any, staffed_workspace: Any, viewer: Any, outsider: Any
    ) -> None:
        response = client_for(viewer).post(
            invite_url(staffed_workspace),
            {"email": outsider.email, "role": "viewer"},
        )

        assert response.status_code == 403

    def test_non_member_cannot_invite(
        self, client_for: Any, staffed_workspace: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).post(
            invite_url(staffed_workspace),
            {"email": "someone@streamsync.test", "role": "viewer"},
        )

        assert response.status_code == 404

    def test_cannot_invite_an_existing_member(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        response = client_for(owner).post(
            invite_url(staffed_workspace), {"email": editor.email, "role": "viewer"}
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "ALREADY_A_MEMBER"

    def test_cannot_invite_the_same_person_twice(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        client = client_for(owner)
        payload = {"email": outsider.email, "role": "viewer"}

        client.post(invite_url(staffed_workspace), payload)
        response = client.post(invite_url(staffed_workspace), payload)

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "ALREADY_INVITED"

    def test_cannot_invite_as_owner(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        """A second owner could remove the first. Ownership is transferred."""
        response = client_for(owner).post(
            invite_url(staffed_workspace), {"email": outsider.email, "role": "owner"}
        )

        assert response.status_code == 400

    def test_unregistered_email_is_a_clear_error(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        """
        Emailing a signup link needs the mail pipeline from Milestone 8, so
        this says so plainly instead of failing opaquely.
        """
        response = client_for(owner).post(
            invite_url(staffed_workspace),
            {"email": "stranger@example.com", "role": "viewer"},
        )

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "USER_NOT_REGISTERED"


class TestInvitationAcceptance:
    def test_invitee_sees_their_pending_invitation(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        """
        The row names the workspace and the inviter.

        This endpoint is the *only* place an invited person can find the
        workspace: one they have not joined is deliberately absent from
        `GET /api/workspaces/`. A row that omitted the name would leave them
        deciding whether to join something unnamed. `status` is not asserted
        because every row here is by definition invited.
        """
        client_for(owner).post(
            invite_url(staffed_workspace), {"email": outsider.email, "role": "editor"}
        )

        body = client_for(outsider).get(reverse("workspaces:my-invitations")).json()

        assert body["count"] == 1
        invitation = body["results"][0]
        assert invitation["workspace_id"] == str(staffed_workspace.id)
        assert invitation["workspace_name"] == staffed_workspace.name
        assert invitation["role"] == "editor"
        assert invitation["invited_by"]["name"] == owner.name
        assert invitation["invited_at"]

    def test_accepting_grants_access(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        client_for(owner).post(
            invite_url(staffed_workspace), {"email": outsider.email, "role": "editor"}
        )

        url = reverse("workspaces:invitation-accept", args=[staffed_workspace.id])
        response = client_for(outsider).post(url)

        assert response.status_code == 200
        assert response.json()["status"] == "active"

        detail = reverse("workspaces:detail", args=[staffed_workspace.id])
        assert client_for(outsider).get(detail).status_code == 200

    def test_accepting_records_the_join_time(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        client_for(owner).post(
            invite_url(staffed_workspace), {"email": outsider.email, "role": "editor"}
        )
        assert membership_of(staffed_workspace, outsider).joined_at is None

        url = reverse("workspaces:invitation-accept", args=[staffed_workspace.id])
        client_for(outsider).post(url)

        membership = membership_of(staffed_workspace, outsider)
        assert membership.status == MembershipStatus.ACTIVE
        assert membership.joined_at is not None

    def test_cannot_accept_an_invitation_that_was_not_issued(
        self, client_for: Any, staffed_workspace: Any, outsider: Any
    ) -> None:
        """Otherwise anyone knowing a workspace id could join it."""
        url = reverse("workspaces:invitation-accept", args=[staffed_workspace.id])

        assert client_for(outsider).post(url).status_code == 404

    def test_cannot_accept_an_invitation_addressed_to_someone_else(
        self,
        client_for: Any,
        staffed_workspace: Any,
        owner: Any,
        outsider: Any,
        user_factory: Any,
    ) -> None:
        interloper = user_factory(email="interloper@streamsync.test")
        client_for(owner).post(
            invite_url(staffed_workspace), {"email": outsider.email, "role": "editor"}
        )

        url = reverse("workspaces:invitation-accept", args=[staffed_workspace.id])

        assert client_for(interloper).post(url).status_code == 404


class TestRoleChanges:
    def test_owner_can_change_a_members_role(
        self, client_for: Any, staffed_workspace: Any, owner: Any, viewer: Any
    ) -> None:
        membership = membership_of(staffed_workspace, viewer)

        response = client_for(owner).patch(
            member_url(staffed_workspace, membership), {"role": "editor"}
        )

        assert response.status_code == 200
        assert response.json()["role"] == "editor"

    def test_promoting_a_viewer_grants_edit_rights_immediately(
        self, client_for: Any, staffed_workspace: Any, owner: Any, viewer: Any
    ) -> None:
        """Roles are read per request, so a change takes effect at once."""
        detail = reverse("workspaces:detail", args=[staffed_workspace.id])
        assert client_for(viewer).get(detail).json()["role"] == "viewer"

        membership = membership_of(staffed_workspace, viewer)
        client_for(owner).patch(
            member_url(staffed_workspace, membership), {"role": "editor"}
        )

        assert client_for(viewer).get(detail).json()["role"] == "editor"

    def test_editor_cannot_change_roles(
        self, client_for: Any, staffed_workspace: Any, editor: Any, viewer: Any
    ) -> None:
        membership = membership_of(staffed_workspace, viewer)

        response = client_for(editor).patch(
            member_url(staffed_workspace, membership), {"role": "editor"}
        )

        assert response.status_code == 403
        assert membership_of(staffed_workspace, viewer).role == WorkspaceRole.VIEWER

    def test_viewer_cannot_promote_themselves(
        self, client_for: Any, staffed_workspace: Any, viewer: Any
    ) -> None:
        """The most direct privilege-escalation attempt there is."""
        membership = membership_of(staffed_workspace, viewer)

        response = client_for(viewer).patch(
            member_url(staffed_workspace, membership), {"role": "editor"}
        )

        assert response.status_code == 403
        assert membership_of(staffed_workspace, viewer).role == WorkspaceRole.VIEWER

    def test_cannot_promote_anyone_to_owner(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        membership = membership_of(staffed_workspace, editor)

        response = client_for(owner).patch(
            member_url(staffed_workspace, membership), {"role": "owner"}
        )

        assert response.status_code == 400

    def test_owners_own_role_is_immutable(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        """
        Demoting it would leave `Workspace.owner` pointing at someone without
        the owner role — two sources of truth disagreeing, and nobody able to
        administer the workspace.
        """
        membership = membership_of(staffed_workspace, owner)

        response = client_for(owner).patch(
            member_url(staffed_workspace, membership), {"role": "editor"}
        )

        assert response.status_code == 400
        assert membership_of(staffed_workspace, owner).role == WorkspaceRole.OWNER

    def test_membership_from_another_workspace_is_not_reachable(
        self,
        client_for: Any,
        staffed_workspace: Any,
        owner: Any,
        outsider: Any,
    ) -> None:
        """
        Cross-workspace id confusion: a valid membership id from a workspace
        the caller owns must not be operable through a different workspace.
        """
        from apps.workspaces import services

        other = services.create_workspace(owner=outsider, name="Other Team")
        foreign = membership_of(other, outsider)

        url = reverse(
            "workspaces:member-detail", args=[staffed_workspace.id, foreign.id]
        )
        response = client_for(owner).patch(url, {"role": "editor"})

        assert response.status_code == 404


class TestMemberRemoval:
    def test_owner_can_remove_a_member(
        self, client_for: Any, staffed_workspace: Any, owner: Any, viewer: Any
    ) -> None:
        membership = membership_of(staffed_workspace, viewer)

        response = client_for(owner).delete(member_url(staffed_workspace, membership))

        assert response.status_code == 204
        assert not WorkspaceMembership.objects.filter(id=membership.id).exists()

    def test_removed_member_loses_access(
        self, client_for: Any, staffed_workspace: Any, owner: Any, viewer: Any
    ) -> None:
        membership = membership_of(staffed_workspace, viewer)
        client_for(owner).delete(member_url(staffed_workspace, membership))

        detail = reverse("workspaces:detail", args=[staffed_workspace.id])

        assert client_for(viewer).get(detail).status_code == 404

    def test_removing_an_invited_person_revokes_the_invitation(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        """One removal path for members and invitees alike."""
        client_for(owner).post(
            invite_url(staffed_workspace), {"email": outsider.email, "role": "viewer"}
        )
        membership = membership_of(staffed_workspace, outsider)

        response = client_for(owner).delete(member_url(staffed_workspace, membership))

        assert response.status_code == 204
        assert not WorkspaceMembership.objects.filter(id=membership.id).exists()

    def test_a_member_can_remove_themselves(
        self, client_for: Any, staffed_workspace: Any, viewer: Any
    ) -> None:
        """Leaving must not require asking the owner to do it for you."""
        membership = membership_of(staffed_workspace, viewer)

        response = client_for(viewer).delete(member_url(staffed_workspace, membership))

        assert response.status_code == 204

    def test_editor_cannot_remove_another_member(
        self, client_for: Any, staffed_workspace: Any, editor: Any, viewer: Any
    ) -> None:
        membership = membership_of(staffed_workspace, viewer)

        response = client_for(editor).delete(member_url(staffed_workspace, membership))

        assert response.status_code == 403
        assert WorkspaceMembership.objects.filter(id=membership.id).exists()

    def test_viewer_cannot_remove_another_member(
        self, client_for: Any, staffed_workspace: Any, viewer: Any, editor: Any
    ) -> None:
        membership = membership_of(staffed_workspace, editor)

        response = client_for(viewer).delete(member_url(staffed_workspace, membership))

        assert response.status_code == 403

    def test_owner_cannot_be_removed(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        """A workspace with no owner has nobody who can administer it."""
        membership = membership_of(staffed_workspace, owner)

        response = client_for(owner).delete(member_url(staffed_workspace, membership))

        assert response.status_code == 400
        assert WorkspaceMembership.objects.filter(id=membership.id).exists()

    def test_non_member_cannot_remove_anyone(
        self, client_for: Any, staffed_workspace: Any, outsider: Any, editor: Any
    ) -> None:
        membership = membership_of(staffed_workspace, editor)

        response = client_for(outsider).delete(
            member_url(staffed_workspace, membership)
        )

        assert response.status_code == 404
        assert WorkspaceMembership.objects.filter(id=membership.id).exists()

    def test_unknown_membership_is_404(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        url = reverse(
            "workspaces:member-detail", args=[staffed_workspace.id, uuid.uuid4()]
        )

        assert client_for(owner).delete(url).status_code == 404
