"""
Workspace and membership workflows.

Anything that touches more than one row, or that must hold an invariant across
rows, lives here rather than in a view or a serializer. Creating a workspace is
the clearest case: a workspace without an owner membership is a workspace
nobody — including its creator — can open, so the two writes are one
transaction. (README §21, §36)
"""

import logging
import secrets

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models.functions import Lower
from django.utils import timezone
from django.utils.text import slugify

from common.exceptions import ApplicationError, ConflictError, ErrorCode
from common.tasks import enqueue

from .models import MembershipStatus, Workspace, WorkspaceMembership, WorkspaceRole

logger = logging.getLogger("streamsync.workspaces")

User = get_user_model()

MAX_SLUG_LENGTH = 120


class MembershipError(ApplicationError):
    """A membership change that the workspace's current state does not allow."""

    status_code = 400
    default_code = ErrorCode.VALIDATION_ERROR
    default_detail = "That membership change is not allowed."


class UserNotRegisteredError(ApplicationError):
    """
    Invited an email with no StreamSync account.

    Inviting a stranger requires emailing them a signup link, and email
    delivery arrives with Celery in Milestone 8. Until then an invitation can
    only be extended to someone who already has an account, and saying so
    plainly beats creating a placeholder account the invitee cannot use.
    """

    status_code = 400
    default_code = "USER_NOT_REGISTERED"
    default_detail = (
        "No StreamSync account uses that email address. "
        "Ask them to sign up first, then invite them."
    )


def generate_unique_slug(name: str) -> str:
    """
    Build a URL-safe, globally unique slug.

    Assigned once at creation and never regenerated on rename: a slug that
    changes silently breaks every link and bookmark pointing at the workspace.
    """
    base = slugify(name)[: MAX_SLUG_LENGTH - 8] or "workspace"

    if not Workspace.objects.filter(slug=base).exists():
        return base

    # A random suffix rather than an incrementing counter. A counter needs a
    # read-then-write that two concurrent creations can both pass, and it
    # leaks how many similarly named workspaces exist.
    for _attempt in range(5):
        candidate = f"{base}-{secrets.token_hex(3)}"
        if not Workspace.objects.filter(slug=candidate).exists():
            return candidate

    # Effectively unreachable; the unique constraint is the real guarantee.
    return f"{base}-{secrets.token_hex(6)}"


@transaction.atomic
def create_workspace(*, owner, name: str, description: str = "") -> Workspace:
    """
    Create a workspace and make its creator the owner.

    Atomic on purpose: a workspace row without its owner membership would be
    invisible to every query in the system, including its creator's, and
    unreachable through any endpoint. (README §21)
    """
    workspace = Workspace.objects.create(
        name=name,
        slug=generate_unique_slug(name),
        description=description,
        owner=owner,
    )

    WorkspaceMembership.objects.create(
        workspace=workspace,
        user=owner,
        role=WorkspaceRole.OWNER,
        status=MembershipStatus.ACTIVE,
        joined_at=timezone.now(),
    )

    logger.info(
        "Workspace created",
        extra={
            "workspace_id": str(workspace.id),
            "user_id": str(owner.id),
            "event": "workspace.created",
        },
    )

    return workspace


@transaction.atomic
def invite_member(
    *, workspace: Workspace, invited_by, email: str, role: str
) -> WorkspaceMembership:
    """
    Invite someone to a workspace.

    Creates a membership in the INVITED state rather than a separate
    invitation record — see `MembershipStatus` for why. The invitee becomes an
    active member only once they accept.
    """
    if role == WorkspaceRole.OWNER:
        # Ownership is transferred, never granted alongside an existing owner.
        # Allowing it here would let an owner create a second owner who could
        # then remove the first.
        raise MembershipError(
            "A workspace has a single owner. Invite as editor or viewer.",
            code="OWNER_ROLE_NOT_INVITABLE",
        )

    normalized = User.objects.normalize_email(email).strip()

    user = (
        User.objects.annotate(email_lower=Lower("email"))
        .filter(email_lower=normalized.lower())
        .first()
    )
    if user is None:
        raise UserNotRegisteredError

    existing = WorkspaceMembership.objects.filter(
        workspace=workspace, user=user
    ).first()
    if existing is not None:
        # Distinguished so the UI can say something useful instead of a
        # generic conflict.
        if existing.status == MembershipStatus.ACTIVE:
            raise ConflictError(
                "That person is already a member of this workspace.",
                code="ALREADY_A_MEMBER",
            )
        raise ConflictError(
            "That person has already been invited to this workspace.",
            code="ALREADY_INVITED",
        )

    membership = WorkspaceMembership.objects.create(
        workspace=workspace,
        user=user,
        role=role,
        status=MembershipStatus.INVITED,
        invited_by=invited_by,
    )

    # Imported here rather than at module scope: apps.activity imports
    # apps.workspaces for its Workspace foreign key, so a top-level import
    # would close the loop.
    from apps.activity import services as activity
    from apps.activity.models import ActivityAction, EntityType

    activity.record(
        workspace=workspace,
        actor=invited_by,
        action=ActivityAction.MEMBER_INVITED,
        entity_type=EntityType.MEMBER,
        entity_id=membership.id,
        name=user.name,
        href=f"/app/workspaces/{workspace.id}/members",
        context=role,
    )

    membership_id = str(membership.id)
    transaction.on_commit(lambda: _notify_invitation(membership_id))

    logger.info(
        "Workspace invitation sent",
        extra={
            "workspace_id": str(workspace.id),
            "user_id": str(user.id),
            "invited_by": str(invited_by.id),
            "role": role,
            "event": "workspace.invited",
        },
    )

    return membership


@transaction.atomic
def accept_invitation(*, workspace: Workspace, user) -> WorkspaceMembership:
    """Turn the caller's outstanding invitation into active membership."""
    membership = WorkspaceMembership.objects.filter(
        workspace=workspace, user=user, status=MembershipStatus.INVITED
    ).first()

    if membership is None:
        raise MembershipError(
            "You do not have an invitation to this workspace.",
            code="NO_PENDING_INVITATION",
        )

    membership.status = MembershipStatus.ACTIVE
    membership.joined_at = timezone.now()
    membership.save(update_fields=["status", "joined_at", "updated_at"])

    logger.info(
        "Workspace invitation accepted",
        extra={
            "workspace_id": str(workspace.id),
            "user_id": str(user.id),
            "event": "workspace.invitation.accepted",
        },
    )

    return membership


@transaction.atomic
def change_member_role(
    *, membership: WorkspaceMembership, role: str
) -> WorkspaceMembership:
    """
    Change what a member may do.

    The owner's own membership is immutable here. Demoting it would leave the
    workspace with an `owner` foreign key pointing at someone who no longer
    holds the owner role — two sources of truth disagreeing, and nobody able to
    administer the workspace.
    """
    if membership.role == WorkspaceRole.OWNER:
        raise MembershipError(
            "The workspace owner's role cannot be changed. Transfer ownership instead.",
            code="OWNER_ROLE_IMMUTABLE",
        )

    if role == WorkspaceRole.OWNER:
        raise MembershipError(
            "Use ownership transfer to make someone an owner.",
            code="OWNER_ROLE_NOT_ASSIGNABLE",
        )

    membership.role = role
    membership.save(update_fields=["role", "updated_at"])

    logger.info(
        "Workspace member role changed",
        extra={
            "workspace_id": str(membership.workspace_id),
            "user_id": str(membership.user_id),
            "role": role,
            "event": "workspace.member.role_changed",
        },
    )

    return membership


@transaction.atomic
def remove_member(*, membership: WorkspaceMembership) -> None:
    """
    Remove a member, or revoke an outstanding invitation.

    Refuses to remove the owner: a workspace with no owner has no one who can
    invite, rename or delete it, and nothing else in the system would restore
    that state.
    """
    if membership.role == WorkspaceRole.OWNER:
        raise MembershipError(
            "The workspace owner cannot be removed. Transfer ownership first.",
            code="OWNER_CANNOT_BE_REMOVED",
        )

    workspace_id = str(membership.workspace_id)
    user_id = str(membership.user_id)

    membership.delete()

    logger.info(
        "Workspace member removed",
        extra={
            "workspace_id": workspace_id,
            "user_id": user_id,
            "event": "workspace.member.removed",
        },
    )


@transaction.atomic
def update_workspace(*, workspace: Workspace, **fields) -> Workspace:
    """
    Rename a workspace or change its description.

    The slug is intentionally not recomputed — see `generate_unique_slug`.
    """
    allowed = {"name", "description"}
    changed = [field for field in fields if field in allowed]

    for field in changed:
        setattr(workspace, field, fields[field])

    if changed:
        workspace.save(update_fields=[*changed, "updated_at"])

    return workspace


def _notify_invitation(membership_id: str) -> None:
    """
    Queue the invitation notification.

    Imported inside the function rather than at module scope: the notifications
    app imports Workspace, so a top-level import here would close the loop.
    """
    from apps.notifications.tasks import notify_workspace_invitation

    enqueue(notify_workspace_invitation, membership_id=membership_id)
