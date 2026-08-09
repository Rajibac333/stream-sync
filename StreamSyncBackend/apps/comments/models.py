"""
Comments on documents and tasks.

One model for both, addressed by the resource it hangs off. The frontend
reaches for the same thread UI in the document editor and the task dialog, so
splitting this into DocumentComment and TaskComment would mean two models, two
services and two endpoints for one behaviour. (README §11)
"""

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

from apps.documents.models import Document
from apps.tasks.models import Task
from apps.workspaces.models import Workspace
from common.models import BaseModel


class CommentResource(models.TextChoices):
    """What a comment can be attached to. Matches the frontend's union."""

    DOCUMENT = "document", _("Document")
    TASK = "task", _("Task")


class CommentQuerySet(models.QuerySet):
    def roots(self) -> "CommentQuerySet":
        """Top-level comments — the threads themselves, without their replies."""
        return self.filter(parent__isnull=True)

    def unresolved(self) -> "CommentQuerySet":
        return self.filter(is_resolved=False)


class Comment(BaseModel):
    """
    A comment, or a reply to one.

    Threads are exactly one level deep: a comment with `parent` set is a reply,
    and a reply cannot itself be replied to. That is what the frontend renders
    — `CommentReply` has no nested replies of its own — and arbitrary nesting
    produces threads nobody can follow.
    """

    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="comments",
        verbose_name=_("workspace"),
    )

    # Exactly one of these is set; the constraint below enforces it. Both are
    # CASCADE — a comment on a deleted document has nothing left to say.
    document = models.ForeignKey(
        Document,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="comments",
        verbose_name=_("document"),
    )
    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="comments",
        verbose_name=_("task"),
    )

    # Null for a thread root. CASCADE so deleting a thread takes its replies.
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="replies",
        verbose_name=_("parent comment"),
    )

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="comments",
        verbose_name=_("author"),
    )

    body = models.TextField(_("body"), max_length=5000)

    # Structured @mentions: [{"user_id": "...", "name": "..."}]. Stored beside
    # the body rather than parsed out of it at render time — parsing display
    # names back out of prose is ambiguous the moment two people share a first
    # name, and it breaks entirely when someone renames themselves afterwards.
    mentions = models.JSONField(_("mentions"), default=list, blank=True)

    # The text the thread was anchored to, when anchored to a selection. A
    # snapshot: the document moves on, and the quote should still show what was
    # being discussed.
    quoted_text = models.CharField(
        _("quoted text"), max_length=500, blank=True, default=""
    )

    is_resolved = models.BooleanField(_("resolved"), default=False)
    resolved_at = models.DateTimeField(_("resolved at"), null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="resolved_comments",
        verbose_name=_("resolved by"),
    )

    # Set when the body is changed after posting, so the UI can mark it edited
    # rather than silently rewriting what someone said.
    edited_at = models.DateTimeField(_("edited at"), null=True, blank=True)

    objects = CommentQuerySet.as_manager()

    class Meta:
        verbose_name = _("comment")
        verbose_name_plural = _("comments")
        # Oldest first: a conversation reads top to bottom.
        ordering = ["created_at", "id"]
        constraints = [
            # README §11: a comment belongs to a document OR a task, never
            # both and never neither. Enforced by the database rather than by
            # convention, so no code path can create an orphan.
            models.CheckConstraint(
                condition=(
                    Q(document__isnull=False, task__isnull=True)
                    | Q(document__isnull=True, task__isnull=False)
                ),
                name="comment_targets_exactly_one_resource",
            ),
            # Resolution is a property of a thread, not of an individual reply.
            models.CheckConstraint(
                condition=Q(parent__isnull=True) | Q(is_resolved=False),
                name="comment_reply_cannot_be_resolved",
            ),
        ]
        indexes = [
            models.Index(
                fields=["document", "created_at"], name="comment_document_idx"
            ),
            models.Index(fields=["task", "created_at"], name="comment_task_idx"),
            models.Index(fields=["parent"], name="comment_parent_idx"),
            models.Index(
                fields=["workspace", "-created_at"], name="comment_ws_created_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"Comment by {self.author_id} on {self.resource_type}"

    def get_workspace(self) -> Workspace:
        """Lets the shared workspace permission classes resolve this object."""
        return self.workspace

    @property
    def is_reply(self) -> bool:
        return self.parent_id is not None

    @property
    def resource_type(self) -> str:
        return CommentResource.DOCUMENT if self.document_id else CommentResource.TASK

    @property
    def resource_id(self):
        return self.document_id or self.task_id
