"""
Workspace endpoints.

    GET    /api/workspaces/                        workspaces I belong to
    POST   /api/workspaces/                        create one
    GET    /api/workspaces/invitations/            my pending invitations
    GET    /api/workspaces/<id>/                   detail
    PATCH  /api/workspaces/<id>/                   rename (owner)
    DELETE /api/workspaces/<id>/                   delete (owner)
    GET    /api/workspaces/<id>/members/           members and pending invites
    POST   /api/workspaces/<id>/invitations/       invite (owner)
    POST   /api/workspaces/<id>/invitations/accept/  accept my invitation
    PATCH  /api/workspaces/<id>/members/<id>/      change role (owner)
    DELETE /api/workspaces/<id>/members/<id>/      remove or leave

WORKSPACE ISOLATION

Isolation is enforced by the queryset, not by a permission check. Every lookup
starts from `visible_workspaces(request.user)`, so a workspace the caller does
not belong to is not merely forbidden — it is not in the result set at all, and
the response is 404.

That distinction matters: a 403 would confirm the workspace exists, letting an
attacker enumerate workspace ids. Permissions then decide what a member may do
once past that boundary. (README §16, §20)
"""

import logging

from django.db.models import Count, QuerySet, Subquery
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from common.permissions import (
    IsWorkspaceMember,
    IsWorkspaceMemberOrOwnerForWrite,
    IsWorkspaceOwner,
)

from . import services
from .models import MembershipStatus, Workspace, WorkspaceMembership
from .selectors import accessible_workspaces, active_membership_subquery
from .serializers import (
    InviteMemberSerializer,
    PendingInvitationSerializer,
    UpdateMemberRoleSerializer,
    WorkspaceCreateSerializer,
    WorkspaceMemberSerializer,
    WorkspaceSerializer,
    WorkspaceUpdateSerializer,
)
from .throttles import InvitationThrottle

logger = logging.getLogger("streamsync.workspaces")


def visible_workspaces(user) -> QuerySet[Workspace]:
    """
    The workspaces `user` may see, annotated for display.

    The single chokepoint for isolation. Every workspace endpoint starts here,
    so there is one place to audit — and one place a future milestone has to
    reuse rather than rewrite.
    """
    requester_membership = active_membership_subquery(user)

    return (
        # accessible_workspaces() filters with Exists() rather than a relation
        # join. A join would multiply rows and be aggregated by the Count
        # below, so member_count would only ever count the caller's own row and
        # always report 1.
        accessible_workspaces(user)
        .annotate(
            # Invited people are counted: they occupy a seat and appear in the
            # members list, which is what the client renders this against.
            member_count=Count("memberships", distinct=True),
            request_role=Subquery(requester_membership.values("role")[:1]),
        )
        .select_related("owner")
        # Explicit, not inherited from Meta.ordering: the Count annotation adds
        # a GROUP BY, and Django treats a grouped queryset as unordered, which
        # makes pagination return unstable pages. Name is not unique, so id
        # breaks ties and guarantees a total order.
        .order_by("name", "id")
    )


class WorkspaceListCreateView(GenericAPIView):
    """List the caller's workspaces, or create one."""

    permission_classes = [IsAuthenticated]
    serializer_class = WorkspaceSerializer

    def get_queryset(self) -> QuerySet[Workspace]:
        return visible_workspaces(self.request.user)

    @extend_schema(
        operation_id="workspaces_list",
        summary="List my workspaces",
        description=(
            "Only workspaces where the caller holds an active membership. "
            "Pending invitations are not included — see "
            "`/api/workspaces/invitations/`."
        ),
        responses={200: WorkspaceSerializer(many=True)},
        tags=["workspaces"],
    )
    def get(self, request: Request) -> Response:
        page = self.paginate_queryset(self.get_queryset())
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @extend_schema(
        operation_id="workspaces_create",
        summary="Create a workspace",
        description="The creator becomes its owner in the same transaction.",
        request=WorkspaceCreateSerializer,
        responses={201: WorkspaceSerializer},
        tags=["workspaces"],
    )
    def post(self, request: Request) -> Response:
        serializer = WorkspaceCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        workspace = services.create_workspace(
            owner=request.user,
            name=serializer.validated_data["name"],
            description=serializer.validated_data["description"],
        )

        # Re-read through the annotated queryset so the response carries
        # member_count and role like every other workspace payload.
        created = self.get_queryset().get(pk=workspace.pk)

        return Response(
            WorkspaceSerializer(created, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )


class WorkspaceDetailView(GenericAPIView):
    """Retrieve, rename or delete a single workspace."""

    permission_classes = [IsAuthenticated, IsWorkspaceMemberOrOwnerForWrite]
    serializer_class = WorkspaceSerializer
    lookup_url_kwarg = "workspace_id"

    def get_queryset(self) -> QuerySet[Workspace]:
        return visible_workspaces(self.request.user)

    def get_object(self) -> Workspace:
        workspace = get_object_or_404(
            self.get_queryset(), pk=self.kwargs["workspace_id"]
        )
        self.check_object_permissions(self.request, workspace)
        return workspace

    @extend_schema(
        operation_id="workspaces_retrieve",
        summary="Workspace detail",
        description="404 for a workspace the caller is not a member of.",
        responses={
            200: WorkspaceSerializer,
            404: OpenApiResponse(description="Not found."),
        },
        tags=["workspaces"],
    )
    def get(self, request: Request, workspace_id) -> Response:
        return Response(self.get_serializer(self.get_object()).data)

    @extend_schema(
        operation_id="workspaces_update",
        summary="Rename a workspace",
        description="Owner only. The slug is fixed at creation and never changes.",
        request=WorkspaceUpdateSerializer,
        responses={
            200: WorkspaceSerializer,
            403: OpenApiResponse(description="Not the owner."),
        },
        tags=["workspaces"],
    )
    def patch(self, request: Request, workspace_id) -> Response:
        workspace = self.get_object()

        serializer = WorkspaceUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        services.update_workspace(workspace=workspace, **serializer.validated_data)

        updated = self.get_queryset().get(pk=workspace.pk)
        return Response(self.get_serializer(updated).data)

    @extend_schema(
        operation_id="workspaces_destroy",
        summary="Delete a workspace",
        description="Owner only. Removes every membership with it.",
        responses={204: OpenApiResponse(description="Deleted.")},
        tags=["workspaces"],
    )
    def delete(self, request: Request, workspace_id) -> Response:
        workspace = self.get_object()

        logger.info(
            "Workspace deleted",
            extra={
                "workspace_id": str(workspace.id),
                "user_id": str(request.user.id),
                "event": "workspace.deleted",
            },
        )
        workspace.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceMemberListView(GenericAPIView):
    """Members and outstanding invitations, in one list."""

    permission_classes = [IsAuthenticated, IsWorkspaceMember]
    serializer_class = WorkspaceMemberSerializer

    def get_workspace(self) -> Workspace:
        workspace = get_object_or_404(
            visible_workspaces(self.request.user), pk=self.kwargs["workspace_id"]
        )
        self.check_object_permissions(self.request, workspace)
        return workspace

    def get_queryset(self) -> QuerySet[WorkspaceMembership]:
        return (
            WorkspaceMembership.objects.filter(workspace=self.get_workspace())
            # Without select_related this is one extra query per member.
            .select_related("user")
            .order_by("status", "created_at")
        )

    @extend_schema(
        operation_id="workspaces_members_list",
        summary="List members",
        description=(
            "Active members and pending invitations together, distinguished by "
            "`status`. Any member of the workspace may read this."
        ),
        responses={200: WorkspaceMemberSerializer(many=True)},
        tags=["workspaces"],
    )
    def get(self, request: Request, workspace_id) -> Response:
        page = self.paginate_queryset(self.get_queryset())
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)


class WorkspaceInvitationView(GenericAPIView):
    """Invite someone to a workspace."""

    permission_classes = [IsAuthenticated, IsWorkspaceOwner]
    # Tighter than the global per-user limit. An invitation is a write that
    # reaches a person, which is the same reason login and registration carry
    # their own scopes. (README §24)
    throttle_classes = [InvitationThrottle]
    serializer_class = InviteMemberSerializer

    def get_workspace(self) -> Workspace:
        workspace = get_object_or_404(
            visible_workspaces(self.request.user), pk=self.kwargs["workspace_id"]
        )
        self.check_object_permissions(self.request, workspace)
        return workspace

    @extend_schema(
        operation_id="workspaces_invite",
        summary="Invite a member",
        description=(
            "Owner only. Creates a membership in the `invited` state. The "
            "invitee must already have a StreamSync account — emailing a "
            "signup link needs the mail pipeline from Milestone 8."
        ),
        request=InviteMemberSerializer,
        responses={
            201: WorkspaceMemberSerializer,
            400: OpenApiResponse(description="Unknown email, or owner role requested."),
            403: OpenApiResponse(description="Not the workspace owner."),
            409: OpenApiResponse(description="Already a member or already invited."),
        },
        tags=["workspaces"],
    )
    def post(self, request: Request, workspace_id) -> Response:
        workspace = self.get_workspace()

        serializer = InviteMemberSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        membership = services.invite_member(
            workspace=workspace,
            # From the session, never the body: a client that can name the
            # inviter can attribute an invitation to somebody else.
            invited_by=request.user,
            email=serializer.validated_data["email"],
            role=serializer.validated_data["role"],
        )

        return Response(
            WorkspaceMemberSerializer(membership).data,
            status=status.HTTP_201_CREATED,
        )


class WorkspaceMemberDetailView(APIView):
    """Change a member's role, or remove them."""

    permission_classes = [IsAuthenticated]

    def get_workspace(self, workspace_id) -> Workspace:
        return get_object_or_404(visible_workspaces(self.request.user), pk=workspace_id)

    @staticmethod
    def get_membership(workspace: Workspace, membership_id) -> WorkspaceMembership:
        # Scoped to the workspace, so a membership id from another workspace
        # cannot be operated on by guessing it.
        return get_object_or_404(
            WorkspaceMembership.objects.select_related("user", "workspace"),
            pk=membership_id,
            workspace=workspace,
        )

    @extend_schema(
        operation_id="workspaces_member_update",
        summary="Change a member's role",
        description="Owner only. The owner's own role cannot be changed here.",
        request=UpdateMemberRoleSerializer,
        responses={200: WorkspaceMemberSerializer},
        tags=["workspaces"],
    )
    def patch(self, request: Request, workspace_id, membership_id) -> Response:
        workspace = self.get_workspace(workspace_id)

        permission = IsWorkspaceOwner()
        if not permission.has_object_permission(request, self, workspace):
            self.permission_denied(request, message=permission.message)

        membership = self.get_membership(workspace, membership_id)

        serializer = UpdateMemberRoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        services.change_member_role(
            membership=membership, role=serializer.validated_data["role"]
        )

        return Response(WorkspaceMemberSerializer(membership).data)

    @extend_schema(
        operation_id="workspaces_member_remove",
        summary="Remove a member or leave",
        description=(
            "The owner may remove anyone; any member may remove themselves. "
            "The owner cannot be removed — transfer ownership first."
        ),
        responses={204: OpenApiResponse(description="Removed.")},
        tags=["workspaces"],
    )
    def delete(self, request: Request, workspace_id, membership_id) -> Response:
        workspace = self.get_workspace(workspace_id)
        membership = self.get_membership(workspace, membership_id)

        # Leaving is always permitted; removing somebody else is an owner
        # action. Without the first half, a viewer could not exit a workspace
        # without asking the owner to do it for them.
        is_self = membership.user_id == request.user.id
        if not is_self:
            permission = IsWorkspaceOwner()
            if not permission.has_object_permission(request, self, workspace):
                self.permission_denied(request, message=permission.message)

        services.remove_member(membership=membership)

        return Response(status=status.HTTP_204_NO_CONTENT)


class MyInvitationListView(GenericAPIView):
    """
    Invitations awaiting the caller.

    Pending invitations are excluded from `GET /api/workspaces/` — a workspace
    someone has not joined should not appear in their switcher — so they need
    somewhere to be discovered.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = PendingInvitationSerializer

    def get_queryset(self) -> QuerySet[WorkspaceMembership]:
        return (
            WorkspaceMembership.objects.filter(
                user=self.request.user, status=MembershipStatus.INVITED
            )
            # `invited_by` is rendered on every row — "Raj invited you" — so it
            # is fetched with the rest rather than one query per invitation.
            .select_related("user", "workspace", "invited_by")
            .order_by("-created_at")
        )

    @extend_schema(
        operation_id="workspaces_my_invitations",
        summary="My pending invitations",
        description=(
            "Names the workspace and the inviter: this is what the recipient "
            "decides on, and it is not reachable from anywhere else — a "
            "workspace you have not joined is absent from GET /api/workspaces/."
        ),
        responses={200: PendingInvitationSerializer(many=True)},
        tags=["workspaces"],
    )
    def get(self, request: Request) -> Response:
        page = self.paginate_queryset(self.get_queryset())
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)


class AcceptInvitationView(APIView):
    """
    Accept an invitation.

    Cannot use `visible_workspaces`, which by definition excludes workspaces
    the caller has not joined. The invitation itself is the authorization: the
    lookup is scoped to an INVITED membership belonging to the caller, so
    nobody can accept an invitation addressed to someone else.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="workspaces_invitation_accept",
        summary="Accept an invitation",
        request=None,
        responses={
            200: WorkspaceMemberSerializer,
            400: OpenApiResponse(description="No pending invitation."),
            404: OpenApiResponse(description="No such workspace."),
        },
        tags=["workspaces"],
    )
    def post(self, request: Request, workspace_id) -> Response:
        membership = get_object_or_404(
            WorkspaceMembership.objects.select_related("workspace", "user"),
            workspace_id=workspace_id,
            user=request.user,
            status=MembershipStatus.INVITED,
        )

        services.accept_invitation(workspace=membership.workspace, user=request.user)
        membership.refresh_from_db()

        return Response(WorkspaceMemberSerializer(membership).data)
