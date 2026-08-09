"""
Writing activity.

One function, called from the service layer of whatever just happened. Kept
deliberately small and total: recording that something occurred must never be
the reason the thing itself fails.
"""

import logging
from typing import Any
from uuid import UUID

from django.db import transaction

from apps.workspaces.models import Workspace

from .models import Activity, ActivityAction, EntityType

logger = logging.getLogger("streamsync.activity")

# Copied into metadata so the entry stays readable after the target is gone.
MAX_NAME_LENGTH = 200
MAX_CONTEXT_LENGTH = 280


def record(
    *,
    workspace: Workspace,
    actor,
    action: str,
    entity_type: str,
    entity_id: UUID,
    name: str,
    href: str | None = None,
    context: str | None = None,
    **extra: Any,
) -> Activity | None:
    """
    Append one entry to a workspace's timeline.

    Callers pass the target's display name because the entry has to survive the
    target's deletion — see Activity's docstring.

    Returns None on failure rather than raising. This is called from inside the
    transactions that create tasks and comments, and losing a log line is a far
    better outcome than losing the user's work. The failure is logged so it is
    still visible.

    The inner `atomic()` is what makes that promise keepable. A failed query
    marks the *enclosing* transaction for rollback, so catching the exception
    without a savepoint would leave the outer transaction broken and every
    subsequent query raising TransactionManagementError. The savepoint confines
    the damage to this insert.
    """
    try:
        with transaction.atomic():
            return Activity.objects.create(
                workspace=workspace,
                actor=actor,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                metadata={
                    "name": (name or "")[:MAX_NAME_LENGTH],
                    "href": href,
                    "context": (context or None) and context[:MAX_CONTEXT_LENGTH],
                    # The actor's name at the time, so the feed still reads
                    # correctly if the account is later deactivated or renamed.
                    "actor_name": getattr(actor, "name", None),
                    **extra,
                },
            )
    except Exception:
        logger.exception(
            "Failed to record activity",
            extra={
                "workspace_id": str(workspace.id),
                "action": action,
                "entity_type": entity_type,
                "event": "activity.write_failed",
            },
        )
        return None


__all__ = ["ActivityAction", "EntityType", "record"]
