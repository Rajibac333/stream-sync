"""
Workspace and membership representation.

Field names are the wire contract the frontend already codes against in
`StreamSyncFrontend/src/api/workspaces.ts`: snake_case, `description` nullable,
`member_count` and `role` present on every workspace.
"""

from typing import Any

from rest_framework import serializers

from apps.accounts.serializers import CollaboratorSerializer, UserSerializer
from common.serializers import EmptyAsNullCharField

from .models import (
    ASSIGNABLE_ROLE_CHOICES,
    MembershipStatus,
    Workspace,
    WorkspaceMembership,
    WorkspaceRole,
)


class WorkspaceSerializer(serializers.ModelSerializer):
    """
    A workspace as seen *by the requesting user*.

    `role` is not a property of the workspace — it is a property of the
    relationship between this workspace and whoever is asking. It is included
    here because every screen that renders a workspace also needs to know which
    actions to offer, and a second request per workspace to find that out would
    be wasteful.
    """

    description = EmptyAsNullCharField(read_only=True)
    member_count = serializers.IntegerField(read_only=True)
    role = serializers.SerializerMethodField()

    class Meta:
        model = Workspace
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "member_count",
            "role",
            "created_at",
        ]
        read_only_fields = fields

    def get_role(self, workspace: Workspace) -> str | None:
        """
        Read the annotation the view's queryset attached.

        Falls back to a lookup only when the serializer is used outside that
        queryset, so the list endpoint stays at one query rather than one per
        workspace.
        """
        annotated = getattr(workspace, "request_role", None)
        if annotated is not None:
            return annotated

        user = getattr(self.context.get("request"), "user", None)
        if user is None or not user.is_authenticated:
            return None

        membership = workspace.memberships.filter(
            user=user, status=MembershipStatus.ACTIVE
        ).first()
        return membership.role if membership else None


class WorkspaceCreateSerializer(serializers.Serializer):
    """
    Creation input.

    A plain Serializer rather than a ModelSerializer so that `owner` and `slug`
    are simply not accepted from the client. Both are decided by the service —
    a caller who could set `owner` could create a workspace belonging to
    somebody else.
    """

    name = serializers.CharField(max_length=100, trim_whitespace=True)
    description = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        allow_null=True,
        default="",
    )

    def validate_name(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Please enter a workspace name.")
        return value.strip()

    def validate_description(self, value: str | None) -> str:
        # The frontend sends null for "no description"; the column stores "".
        return (value or "").strip()


class WorkspaceUpdateSerializer(serializers.Serializer):
    """
    Partial update input.

    `slug` is absent by design: it is assigned once and never changes, so that
    existing links keep working after a rename.
    """

    name = serializers.CharField(max_length=100, required=False, trim_whitespace=True)
    description = serializers.CharField(
        max_length=500, required=False, allow_blank=True, allow_null=True
    )

    def validate_name(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Please enter a workspace name.")
        return value.strip()

    def validate_description(self, value: str | None) -> str:
        return (value or "").strip()


class WorkspaceMemberSerializer(serializers.ModelSerializer):
    """One row in the members list — active members and pending invitations."""

    user = UserSerializer(read_only=True)
    joined_at = serializers.SerializerMethodField()

    class Meta:
        model = WorkspaceMembership
        fields = ["id", "user", "role", "status", "joined_at"]
        read_only_fields = fields

    def get_joined_at(self, membership: WorkspaceMembership) -> Any:
        """
        Never null, so the client can always render a date.

        An invited person has not joined yet, so the date shown is when they
        were invited. `status` is what distinguishes the two, and the UI reads
        that rather than inferring from the timestamp.
        """
        return membership.joined_at or membership.created_at


class PendingInvitationSerializer(serializers.ModelSerializer):
    """
    An invitation from the invitee's side.

    Distinct from `WorkspaceMemberSerializer`, which describes somebody *within*
    a workspace you are already looking at and therefore has no reason to name
    it. Here the workspace is the whole point: the recipient is deciding whether
    to join, and "you have been invited as an editor" without saying by whom, or
    to what, is not a decision anyone can make.
    """

    workspace_id = serializers.UUIDField(source="workspace.id", read_only=True)
    workspace_name = serializers.CharField(source="workspace.name", read_only=True)
    workspace_slug = serializers.CharField(source="workspace.slug", read_only=True)
    invited_by = CollaboratorSerializer(read_only=True)
    invited_at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = WorkspaceMembership
        fields = [
            "id",
            "workspace_id",
            "workspace_name",
            "workspace_slug",
            "role",
            "invited_by",
            "invited_at",
        ]
        read_only_fields = fields


class InviteMemberSerializer(serializers.Serializer):
    """Invitation input. The inviter comes from the session, never the body."""

    email = serializers.EmailField(max_length=254)
    role = serializers.ChoiceField(
        choices=ASSIGNABLE_ROLE_CHOICES,
        # The least-privileged option, so an omitted role cannot over-grant.
        default=WorkspaceRole.VIEWER,
    )


class UpdateMemberRoleSerializer(serializers.Serializer):
    """Role change input. Owner is excluded — ownership is transferred."""

    role = serializers.ChoiceField(choices=ASSIGNABLE_ROLE_CHOICES)
