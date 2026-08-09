"""
Comment workflows.

Holds the rules that the database cannot express: one level of threading, who
may edit, who may delete, and who may resolve. (README §36)
"""

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from apps.activity import services as activity
from apps.activity.models import ActivityAction, EntityType
from apps.documents.models import Document
from apps.tasks.models import Task
from apps.workspaces.models import (
    MembershipStatus,
    Workspace,
    WorkspaceMembership,
    WorkspaceRole,
)
from common.exceptions import ApplicationError, ErrorCode
from common.tasks import enqueue

from .models import Comment, CommentResource

logger = logging.getLogger("streamsync.comments")

User = get_user_model()

# How much of the body is quoted into the activity feed.
ACTIVITY_EXCERPT_LENGTH = 140


class CommentRuleError(ApplicationError):
    """A comment operation the thread's state does not allow."""

    status_code = 400
    default_code = ErrorCode.VALIDATION_ERROR
    default_detail = "That comment operation is not allowed."


class NotCommentAuthorError(ApplicationError):
    """
    Editing somebody else's words.

    Not even the workspace owner may do this. Deleting another person's comment
    is moderation; rewriting it is putting words in their mouth, and no role
    should carry that.
    """

    status_code = 403
    default_code = ErrorCode.PERMISSION_DENIED
    default_detail = "Only the author can edit a comment."


class CannotDeleteCommentError(ApplicationError):
    status_code = 403
    default_code = ErrorCode.PERMISSION_DENIED
    default_detail = "You can only delete your own comments."


def resolve_mentions(workspace: Workspace, mention_ids: list) -> list[dict]:
    """
    Turn a list of user ids into stored mention references.

    Ids outside the workspace are dropped rather than rejected: a stale client
    can easily send someone who has since left, and failing the whole comment
    over that would lose what the person wrote. Dropping them also stops a
    caller using mentions to probe which user ids exist. (README §16)

    The display name is captured now so historical text stays readable after a
    rename.
    """
    if not mention_ids:
        return []

    members = User.objects.filter(
        id__in=mention_ids,
        workspace_memberships__workspace=workspace,
        workspace_memberships__status=MembershipStatus.ACTIVE,
    ).distinct()

    return [{"user_id": str(user.id), "name": user.name} for user in members]


def _dispatch_mentions(comment: Comment) -> None:
    """
    Queue notifications for everyone named in a comment.

    Fired on commit, so a worker never reads a comment its transaction has not
    written yet, and a rolled-back comment notifies nobody. Skipped entirely
    when nobody was mentioned, which is the common case — no point queueing a
    job to discover an empty list.
    """
    if not comment.mentions:
        return

    from apps.notifications.tasks import notify_comment_mentions

    comment_id = str(comment.id)
    transaction.on_commit(
        lambda: enqueue(notify_comment_mentions, comment_id=comment_id)
    )


def _resource_href(comment: Comment) -> str:
    workspace_id = comment.workspace_id
    if comment.document_id:
        return f"/app/workspaces/{workspace_id}/documents/{comment.document_id}"
    return f"/app/workspaces/{workspace_id}/tasks/{comment.task_id}"


def _resource_name(document: Document | None, task: Task | None) -> str:
    return document.title if document is not None else task.title


@transaction.atomic
def create_comment(
    *,
    workspace: Workspace,
    author,
    document: Document | None = None,
    task: Task | None = None,
    body: str,
    mention_ids: list | None = None,
    quoted_text: str = "",
) -> Comment:
    """Start a thread on a document or a task."""
    if (document is None) == (task is None):
        # The database constraint would catch this too; raising here turns a
        # 500 into a 400 with something a client can act on.
        raise CommentRuleError(
            "A comment must target exactly one document or task.",
            code="COMMENT_TARGET_INVALID",
        )

    comment = Comment.objects.create(
        workspace=workspace,
        document=document,
        task=task,
        author=author,
        body=body,
        mentions=resolve_mentions(workspace, mention_ids or []),
        quoted_text=quoted_text,
    )

    activity.record(
        workspace=workspace,
        actor=author,
        action=ActivityAction.COMMENT_ADDED,
        entity_type=EntityType.COMMENT,
        entity_id=comment.id,
        name=_resource_name(document, task),
        href=_resource_href(comment),
        context=body[:ACTIVITY_EXCERPT_LENGTH],
        resource_type=comment.resource_type,
        resource_id=str(comment.resource_id),
    )

    _dispatch_mentions(comment)

    logger.info(
        "Comment created",
        extra={
            "workspace_id": str(workspace.id),
            "comment_id": str(comment.id),
            "user_id": str(author.id),
            "event": "comment.created",
        },
    )

    return comment


@transaction.atomic
def reply_to_comment(
    *, parent: Comment, author, body: str, mention_ids: list | None = None
) -> Comment:
    """
    Add a reply to an existing thread.

    Threads stay one level deep. Replying to a reply attaches to the same root
    instead of raising: the user's intent is unambiguous, and refusing would be
    pedantry the UI would have to explain.
    """
    root = parent if parent.parent_id is None else parent.parent

    reply = Comment.objects.create(
        workspace=root.workspace,
        # Inherited from the root, never taken from the request. A reply must
        # not be able to target a different resource than its thread.
        document=root.document,
        task=root.task,
        parent=root,
        author=author,
        body=body,
        mentions=resolve_mentions(root.workspace, mention_ids or []),
    )

    activity.record(
        workspace=root.workspace,
        actor=author,
        action=ActivityAction.COMMENT_ADDED,
        entity_type=EntityType.COMMENT,
        entity_id=reply.id,
        name=_resource_name(root.document, root.task),
        href=_resource_href(root),
        context=body[:ACTIVITY_EXCERPT_LENGTH],
        resource_type=root.resource_type,
        resource_id=str(root.resource_id),
    )

    _dispatch_mentions(reply)

    logger.info(
        "Comment reply created",
        extra={
            "workspace_id": str(root.workspace_id),
            "comment_id": str(reply.id),
            "parent_id": str(root.id),
            "user_id": str(author.id),
            "event": "comment.replied",
        },
    )

    return reply


@transaction.atomic
def edit_comment(*, comment: Comment, editor, body: str) -> Comment:
    """Change a comment's body. Author only."""
    if comment.author_id != editor.id:
        raise NotCommentAuthorError

    comment.body = body
    # Marks the comment as edited so the UI can say so, rather than silently
    # rewriting what someone is on record as having said.
    comment.edited_at = timezone.now()
    comment.save(update_fields=["body", "edited_at", "updated_at"])

    return comment


@transaction.atomic
def set_resolved(*, comment: Comment, actor, resolved: bool) -> Comment:
    """
    Resolve or reopen a thread.

    Only a root can be resolved — resolution describes a conversation, not one
    message in it. Replying to a resolved thread reopens it, which is handled
    by the caller rather than here.
    """
    if comment.parent_id is not None:
        raise CommentRuleError(
            "Only a thread can be resolved, not an individual reply.",
            code="COMMENT_IS_A_REPLY",
        )

    comment.is_resolved = resolved
    comment.resolved_at = timezone.now() if resolved else None
    comment.resolved_by = actor if resolved else None
    comment.save(
        update_fields=["is_resolved", "resolved_at", "resolved_by", "updated_at"]
    )

    logger.info(
        "Comment resolution changed",
        extra={
            "workspace_id": str(comment.workspace_id),
            "comment_id": str(comment.id),
            "user_id": str(actor.id),
            "resolved": resolved,
            "event": "comment.resolution_changed",
        },
    )

    return comment


def can_delete(comment: Comment, user) -> bool:
    """
    Authors delete their own comments; workspace owners moderate.

    README §39 says "delete own comment", which is the floor. The owner is
    added because a workspace with no way to remove abusive or leaked content
    has no moderation story at all.
    """
    if comment.author_id == user.id:
        return True

    return WorkspaceMembership.objects.filter(
        workspace_id=comment.workspace_id,
        user=user,
        role=WorkspaceRole.OWNER,
        status=MembershipStatus.ACTIVE,
    ).exists()


@transaction.atomic
def delete_comment(*, comment: Comment, actor) -> None:
    """Delete a comment, and its replies if it is a thread root."""
    if not can_delete(comment, actor):
        raise CannotDeleteCommentError

    comment_id = str(comment.id)
    workspace_id = str(comment.workspace_id)

    # Replies cascade at the database level.
    comment.delete()

    logger.info(
        "Comment deleted",
        extra={
            "workspace_id": workspace_id,
            "comment_id": comment_id,
            "user_id": str(actor.id),
            "event": "comment.deleted",
        },
    )


__all__ = [
    "CannotDeleteCommentError",
    "CommentResource",
    "CommentRuleError",
    "NotCommentAuthorError",
    "can_delete",
    "create_comment",
    "delete_comment",
    "edit_comment",
    "reply_to_comment",
    "resolve_mentions",
    "set_resolved",
]
