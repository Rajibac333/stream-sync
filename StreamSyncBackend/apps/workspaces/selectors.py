"""
Workspace access scoping.

The one place that answers "what may this user see?". Every workspace-scoped
resource — projects and documents now, tasks and comments later — routes its
queryset through here rather than filtering on a workspace id taken from the
URL. A client-supplied workspace id is exactly the thing that must not be
trusted. (README §16, §20)
"""

from django.db.models import Exists, OuterRef, QuerySet

from .models import MembershipStatus, Workspace, WorkspaceMembership


def active_membership_subquery(user, workspace_ref: str = "pk"):
    """
    Correlated subquery matching `user`'s active membership.

    A subquery rather than a join: joining onto memberships multiplies rows and
    silently corrupts any aggregate in the same queryset — which is how
    `member_count` once ended up always reporting 1.
    """
    return WorkspaceMembership.objects.filter(
        workspace=OuterRef(workspace_ref),
        user=user,
        status=MembershipStatus.ACTIVE,
    )


def accessible_workspaces(user) -> QuerySet[Workspace]:
    """Workspaces where `user` holds an active membership. No annotations."""
    if not user or not user.is_authenticated:
        return Workspace.objects.none()

    return Workspace.objects.filter(Exists(active_membership_subquery(user)))


def scoped_to_user_workspaces(
    queryset: QuerySet, user, workspace_field: str = "workspace"
) -> QuerySet:
    """
    Restrict any workspace-owned queryset to the caller's workspaces.

    Because this filters rather than forbids, a row in someone else's workspace
    is *absent*, so lookups return 404 instead of 403. A 403 would confirm the
    object exists and let an attacker enumerate ids. (README §16)
    """
    if not user or not user.is_authenticated:
        return queryset.none()

    return queryset.filter(Exists(active_membership_subquery(user, workspace_field)))
