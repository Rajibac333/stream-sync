"""
Background notification fan-out.

RETRY SAFETY

Every task here is written to survive being run more than once, because it
will be. `CELERY_TASK_ACKS_LATE` redelivers work whose worker died mid-run, and
transient failures retry with backoff. Three things make that safe:

1. **Tasks take ids, never objects.** A serialised model instance is a stale
   snapshot by the time a retry runs, and Celery cannot serialise one anyway.
   Everything is re-read from the database inside the task.

2. **Creating a notification is idempotent.** A partial unique constraint on
   (recipient, type, entity) while unread means a second delivery cannot
   produce a second notification. See `services.notify`.

3. **A vanished subject is success, not failure.** If the task was deleted
   between the event and the retry, there is nothing to notify about and
   nothing to fix — the task returns rather than raising into an infinite
   retry loop.

Tasks are dispatched with `.delay()` from inside service transactions. A task
can therefore start before its transaction commits and find nothing; the
`DoesNotExist` path retries, and the row is there by the next attempt.
"""

import logging

from celery import shared_task
from django.contrib.auth import get_user_model

from .models import EntityType, NotificationType
from .services import notify

logger = logging.getLogger("streamsync.notifications")

User = get_user_model()

# Shared retry policy. Backoff with jitter so a downstream outage does not
# produce a synchronised retry storm when it recovers.
RETRY_KWARGS = {
    "autoretry_for": (Exception,),
    "retry_backoff": 2,
    "retry_backoff_max": 300,
    "retry_jitter": True,
    "max_retries": 5,
    "acks_late": True,
}


def _excerpt(text: str, limit: int = 160) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


@shared_task(name="notifications.task_assigned", **RETRY_KWARGS)
def notify_task_assigned(task_id: str, actor_id: str) -> None:
    """Tell someone a task was assigned to them."""
    from apps.tasks.models import Task

    try:
        task = Task.objects.select_related("workspace", "assignee", "project").get(
            pk=task_id
        )
    except Task.DoesNotExist:
        # Deleted between the event and this run. Nothing to notify about.
        return

    if task.assignee_id is None:
        # Unassigned again before the task ran. Also nothing to do.
        return

    actor = User.objects.filter(pk=actor_id).first()

    notify(
        recipient=task.assignee,
        workspace=task.workspace,
        actor=actor,
        notification_type=NotificationType.TASK_ASSIGNED,
        title=f"{_actor_name(actor)} assigned you “{task.title}”",
        message=_excerpt(task.description),
        entity_type=EntityType.TASK,
        entity_id=task.id,
        href=f"/app/workspaces/{task.workspace_id}/tasks/{task.id}",
    )


@shared_task(name="notifications.task_completed", **RETRY_KWARGS)
def notify_task_completed(task_id: str, actor_id: str) -> None:
    """
    Tell a task's creator that somebody finished it.

    The creator is notified rather than the assignee: the assignee is usually
    the person who just completed it, and `notify` would suppress that anyway.
    """
    from apps.tasks.models import Task

    try:
        task = Task.objects.select_related("workspace", "creator").get(pk=task_id)
    except Task.DoesNotExist:
        return

    actor = User.objects.filter(pk=actor_id).first()

    notify(
        recipient=task.creator,
        workspace=task.workspace,
        actor=actor,
        notification_type=NotificationType.TASK_COMPLETED,
        title=f"{_actor_name(actor)} completed “{task.title}”",
        entity_type=EntityType.TASK,
        entity_id=task.id,
        href=f"/app/workspaces/{task.workspace_id}/tasks/{task.id}",
    )


@shared_task(name="notifications.comment_mentions", **RETRY_KWARGS)
def notify_comment_mentions(comment_id: str) -> None:
    """
    Ping everyone named in a comment.

    Mentions were resolved to workspace members when the comment was written,
    so this does not re-validate them — it re-reads the stored list, which is
    what the comment actually says.
    """
    from apps.comments.models import Comment

    try:
        comment = Comment.objects.select_related(
            "workspace", "author", "document", "task"
        ).get(pk=comment_id)
    except Comment.DoesNotExist:
        return

    mentioned_ids = [
        mention.get("user_id")
        for mention in (comment.mentions or [])
        if mention.get("user_id")
    ]
    if not mentioned_ids:
        return

    subject = comment.document.title if comment.document_id else comment.task.title
    href = (
        f"/app/workspaces/{comment.workspace_id}/documents/{comment.document_id}"
        if comment.document_id
        else f"/app/workspaces/{comment.workspace_id}/tasks/{comment.task_id}"
    )

    # One query for everyone named, rather than one per mention.
    for recipient in User.objects.filter(pk__in=mentioned_ids):
        notify(
            recipient=recipient,
            workspace=comment.workspace,
            actor=comment.author,
            notification_type=NotificationType.MENTION,
            title=f"{_actor_name(comment.author)} mentioned you in “{subject}”",
            message=_excerpt(comment.body),
            # The comment, not the document: two mentions in two comments on
            # one document are two separate notifications, which is right.
            entity_type=EntityType.COMMENT,
            entity_id=comment.id,
            href=href,
        )


@shared_task(name="notifications.project_updated", **RETRY_KWARGS)
def notify_project_updated(project_id: str, actor_id: str, summary: str) -> None:
    """
    Tell a workspace that a project's status changed.

    Fanned out to active members only, and never to the person who made the
    change. Status changes are rare enough to be worth everyone's attention;
    ordinary edits are not notified at all.
    """
    from apps.projects.models import Project
    from apps.workspaces.models import MembershipStatus, WorkspaceMembership

    try:
        project = Project.objects.select_related("workspace").get(pk=project_id)
    except Project.DoesNotExist:
        return

    actor = User.objects.filter(pk=actor_id).first()

    memberships = (
        WorkspaceMembership.objects.filter(
            workspace_id=project.workspace_id, status=MembershipStatus.ACTIVE
        )
        .select_related("user")
        .exclude(user_id=actor_id)
    )

    for membership in memberships:
        notify(
            recipient=membership.user,
            workspace=project.workspace,
            actor=actor,
            notification_type=NotificationType.PROJECT_UPDATE,
            title=f"{_actor_name(actor)} updated “{project.name}”",
            message=summary,
            entity_type=EntityType.PROJECT,
            entity_id=project.id,
            href=f"/app/workspaces/{project.workspace_id}/projects/{project.id}",
        )


@shared_task(name="notifications.workspace_invitation", **RETRY_KWARGS)
def notify_workspace_invitation(membership_id: str) -> None:
    """Tell someone they were invited to a workspace."""
    from apps.workspaces.models import WorkspaceMembership

    try:
        membership = WorkspaceMembership.objects.select_related(
            "workspace", "user", "invited_by"
        ).get(pk=membership_id)
    except WorkspaceMembership.DoesNotExist:
        return

    notify(
        recipient=membership.user,
        workspace=membership.workspace,
        actor=membership.invited_by,
        notification_type=NotificationType.WORKSPACE_INVITATION,
        title=(
            f"{_actor_name(membership.invited_by)} invited you to "
            f"“{membership.workspace.name}”"
        ),
        message=f"You have been invited as {membership.get_role_display().lower()}.",
        entity_type=EntityType.WORKSPACE,
        entity_id=membership.workspace_id,
        href=f"/app/workspaces/{membership.workspace_id}",
    )


@shared_task(name="notifications.purge_read", **RETRY_KWARGS)
def purge_read_notifications(older_than_days: int = 90) -> int:
    """
    Delete long-read notifications.

    Nothing schedules this yet — it is the cleanup job README §22 calls for,
    ready for a beat schedule. Only *read* entries are removed, so nothing
    unseen is ever deleted.
    """
    from datetime import timedelta

    from django.utils import timezone

    from .models import Notification

    cutoff = timezone.now() - timedelta(days=older_than_days)
    deleted, _ = Notification.objects.filter(is_read=True, read_at__lt=cutoff).delete()

    logger.info(
        "Purged read notifications",
        extra={"count": deleted, "event": "notification.purged"},
    )

    return deleted


def _actor_name(actor) -> str:
    """A displayable actor, even when the account is gone."""
    return getattr(actor, "name", None) or "Someone"
