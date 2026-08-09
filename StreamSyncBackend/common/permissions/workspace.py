"""
Workspace role permissions.

Every workspace-scoped rule in the product reduces to one question: does this
user hold an active membership in this workspace, and is its role sufficient?
Answering it in one place means a view added in a later milestone cannot
invent a subtly different version of the rule. (README §37)

These are the *second* line of defence. The first is the queryset: views scope
their querysets to the requesting user's workspaces, so a non-member gets 404
rather than 403 and cannot even confirm that a workspace exists. Permissions
then govern what a member may do once they are through that door.
"""

from typing import ClassVar

from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.workspaces.models import MembershipStatus, WorkspaceRole

# Ranked least to most privileged. Holding a role implies holding every role
# below it, so a check is a comparison rather than a set membership test.
ROLE_ORDER: dict[str, int] = {
    WorkspaceRole.VIEWER: 0,
    WorkspaceRole.EDITOR: 1,
    WorkspaceRole.OWNER: 2,
}


def get_membership(user, workspace):
    """
    The user's active membership in `workspace`, or None.

    Invited-but-not-accepted memberships deliberately do not count: a pending
    invitation is a seat reserved, not access granted.
    """
    if not user or not user.is_authenticated or workspace is None:
        return None

    # Populated by the view's queryset via prefetch when available, so the
    # common path costs no extra query.
    cached = getattr(workspace, "_request_membership", None)
    if cached is not None:
        return cached

    return workspace.memberships.filter(
        user=user, status=MembershipStatus.ACTIVE
    ).first()


def has_workspace_role(user, workspace, minimum: str) -> bool:
    """Whether `user` holds at least `minimum` in `workspace`."""
    membership = get_membership(user, workspace)
    if membership is None:
        return False

    return ROLE_ORDER.get(membership.role, -1) >= ROLE_ORDER[minimum]


class BaseWorkspacePermission(BasePermission):
    """
    Shared behaviour for the role checks below.

    Subclasses set `minimum_role`. The object passed to
    `has_object_permission` is expected to be a Workspace, or anything
    exposing one through `get_workspace()` — which is how documents, tasks and
    comments will plug into these same classes in later milestones without
    changing this file.
    """

    minimum_role: ClassVar[str] = WorkspaceRole.VIEWER
    message = "You do not have permission to perform this action in this workspace."

    def has_permission(self, request, view) -> bool:
        # Object-level checks do the real work; this only rejects anonymous
        # requests early so an unauthenticated caller never reaches a queryset.
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj) -> bool:
        workspace = self._resolve_workspace(obj)
        return has_workspace_role(request.user, workspace, self.minimum_role)

    @staticmethod
    def _resolve_workspace(obj):
        if hasattr(obj, "get_workspace"):
            return obj.get_workspace()
        return getattr(obj, "workspace", obj)


class IsWorkspaceMember(BaseWorkspacePermission):
    """Any active member. Read access to the workspace and its contents."""

    minimum_role = WorkspaceRole.VIEWER


class IsWorkspaceEditor(BaseWorkspacePermission):
    """
    Editor or owner. Creating and changing content inside a workspace.

    Viewers are read-only, which is the entire point of the role. (README §20)
    """

    minimum_role = WorkspaceRole.EDITOR
    message = "Your role in this workspace does not allow changes."


class IsWorkspaceOwner(BaseWorkspacePermission):
    """
    Owner only. Workspace settings, membership and invitations.

    Deliberately not extended to editors: an editor who could invite members
    or change roles could promote themselves to owner, which would make the
    distinction between the two roles meaningless.
    """

    minimum_role = WorkspaceRole.OWNER
    message = "Only the workspace owner can perform this action."


class IsWorkspaceMemberOrOwnerForWrite(BaseWorkspacePermission):
    """
    Read for any member, write for the owner.

    Used by the workspace detail endpoint, where every member may view the
    workspace but only the owner may rename or delete it. (README §37,
    "CanEditWorkspace")
    """

    def has_object_permission(self, request, view, obj) -> bool:
        workspace = self._resolve_workspace(obj)
        minimum = (
            WorkspaceRole.VIEWER
            if request.method in SAFE_METHODS
            else WorkspaceRole.OWNER
        )
        return has_workspace_role(request.user, workspace, minimum)
