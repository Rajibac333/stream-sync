"""
Creating and reading notifications.

This module deliberately imports no domain models beyond Workspace. The tasks
that call it resolve tasks, comments and projects themselves and pass in plain
values, which keeps the notification app from becoming a hub every other app
depends on — and keeps its imports acyclic.
"""

import logging
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.workspaces.models import Workspace

from .models import Notification

logger = logging.getLogger("streamsync.notifications")


def notify(
    *,
    recipient,
    workspace: Workspace,
    actor,
    notification_type: str,
    title: str,
    entity_type: str,
    entity_id: UUID,
    message: str = "",
    href: str = "",
) -> Notification | None:
    """
    Create one notification, or return None if it would be redundant.

    Two things are suppressed:

    1. **Notifying someone about their own action.** Assigning a task to
       yourself, or mentioning yourself, should not ping you. This is the most
       common source of noise and the easiest to get wrong.
    2. **A second unread notification about the same thing.** If you already
       have an unread "you were assigned Implement Stripe", a reassignment does
       not add another. Once you have read the first, a new event notifies
       again.

    The second rule is also enforced by a partial unique constraint, so a
    retried Celery task cannot slip a duplicate past the check-then-write race.
    Losing that race is the *expected* path on a redelivery, not an error, so
    the IntegrityError is caught and treated as "already delivered".
    """
    if recipient is None or (actor is not None and recipient.id == actor.id):
        return None

    try:
        with transaction.atomic():
            notification = Notification.objects.create(
                recipient=recipient,
                workspace=workspace,
                actor=actor,
                type=notification_type,
                title=title,
                message=message,
                entity_type=entity_type,
                entity_id=entity_id,
                href=href,
            )
    except IntegrityError:
        # The constraint fired: an unread notification for this
        # (recipient, type, entity) already exists. Nothing to do.
        logger.debug(
            "Duplicate notification suppressed",
            extra={
                "recipient_id": str(recipient.id),
                "type": notification_type,
                "entity_id": str(entity_id),
                "event": "notification.duplicate_suppressed",
            },
        )
        return None

    logger.info(
        "Notification created",
        extra={
            "recipient_id": str(recipient.id),
            "workspace_id": str(workspace.id),
            "type": notification_type,
            "entity_id": str(entity_id),
            "event": "notification.created",
        },
    )

    return notification


def unread_count(user) -> int:
    """How many unread notifications a user has. Backs the badge."""
    return Notification.objects.for_user(user).unread().count()


@transaction.atomic
def mark_read(*, notification: Notification, read: bool = True) -> Notification:
    """
    Mark one notification read, or put it back to unread.

    Idempotent: marking an already-read notification changes nothing, including
    `read_at`, so the original moment is not overwritten by a double click.
    """
    if notification.is_read == read:
        return notification

    notification.is_read = read
    notification.read_at = timezone.now() if read else None
    notification.save(update_fields=["is_read", "read_at", "updated_at"])

    return notification


@transaction.atomic
def mark_all_read(*, user) -> int:
    """
    Mark every unread notification read. Returns how many changed.

    A single UPDATE rather than a loop: this runs on a list that can be
    hundreds long, and doing it row by row would be hundreds of queries for one
    button press.
    """
    updated = (
        Notification.objects.for_user(user)
        .unread()
        .update(is_read=True, read_at=timezone.now(), updated_at=timezone.now())
    )

    logger.info(
        "Notifications marked read",
        extra={
            "user_id": str(user.id),
            "count": updated,
            "event": "notification.mark_all_read",
        },
    )

    return updated
