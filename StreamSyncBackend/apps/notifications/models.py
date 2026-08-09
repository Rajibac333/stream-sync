"""
Per-user notifications.

A notification is addressed to one person about one thing. It is composed at
write time — title, body and link are stored, not derived on read — so an entry
still reads correctly after the task it refers to is renamed or deleted, the
same reasoning as the activity log. (README §13, §45)
"""

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

from apps.workspaces.models import Workspace
from common.models import BaseModel


class NotificationType(models.TextChoices):
    """
    Why someone is being notified.

    The first five match the frontend's `NotificationType` union
    (StreamSyncFrontend/src/types/notification.ts). `WORKSPACE_INVITATION` is
    additional: README §13 lists invitations as a notifiable event and the
    product has them, but the frontend union has no entry for it. See SETUP.md
    — it needs one line in `NotificationType` and one in its label map.
    """

    MENTION = "mention", _("Mention")
    TASK_ASSIGNED = "task_assigned", _("Task assigned")
    TASK_COMPLETED = "task_completed", _("Task completed")
    DOCUMENT_SHARED = "document_shared", _("Document shared")
    PROJECT_UPDATE = "project_update", _("Project update")
    WORKSPACE_INVITATION = "workspace_invitation", _("Workspace invitation")


class EntityType(models.TextChoices):
    """What the notification points at. Drives the icon and the link."""

    PROJECT = "project", _("Project")
    DOCUMENT = "document", _("Document")
    TASK = "task", _("Task")
    COMMENT = "comment", _("Comment")
    WORKSPACE = "workspace", _("Workspace")


class NotificationQuerySet(models.QuerySet):
    def unread(self) -> "NotificationQuerySet":
        return self.filter(is_read=False)

    def for_user(self, user) -> "NotificationQuerySet":
        return self.filter(recipient=user)


class Notification(BaseModel):
    """One entry in one person's notification list."""

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
        verbose_name=_("recipient"),
    )

    # Scopes the list to a workspace and lets a workspace deletion clean up
    # every notification it produced.
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="notifications",
        verbose_name=_("workspace"),
    )

    # SET_NULL, not CASCADE: a departed account must not delete the
    # notifications it caused. The actor's name is denormalised into the title,
    # so the entry stays readable without them.
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sent_notifications",
        verbose_name=_("actor"),
    )

    type = models.CharField(_("type"), max_length=24, choices=NotificationType.choices)

    # Already-composed: "Maria mentioned you in Checkout Requirements". Built
    # when the event happens, so it survives the subject being renamed.
    title = models.CharField(_("title"), max_length=255)

    # README §13 calls this `message`; it is serialised to the client as `body`
    # to match the frontend contract.
    message = models.TextField(_("message"), max_length=1000, blank=True, default="")

    # A loose pair rather than a foreign key, for the same reason the activity
    # log uses one: a notification about a deleted task must still exist.
    entity_type = models.CharField(
        _("entity type"), max_length=16, choices=EntityType.choices
    )
    entity_id = models.UUIDField(_("entity id"))

    # Where clicking it goes. Stored so the link does not need the target row.
    href = models.CharField(_("href"), max_length=500, blank=True, default="")

    is_read = models.BooleanField(_("read"), default=False)
    read_at = models.DateTimeField(_("read at"), null=True, blank=True)

    objects = NotificationQuerySet.as_manager()

    class Meta:
        verbose_name = _("notification")
        verbose_name_plural = _("notifications")
        # Newest first: a notification list is read from the top.
        ordering = ["-created_at", "-id"]
        constraints = [
            # Collapses repeat pings about the same thing while the first is
            # still unread. Reassigning a task three times leaves one unread
            # notification, not three.
            #
            # Enforced by the database rather than only in the service, because
            # notifications are written from Celery tasks that retry: a task
            # re-delivered after a worker died must not produce a second copy.
            # This is what makes those tasks genuinely idempotent.
            models.UniqueConstraint(
                fields=["recipient", "type", "entity_type", "entity_id"],
                condition=Q(is_read=False),
                name="notification_unread_unique_per_entity",
            ),
        ]
        indexes = [
            # The notification list: one person's, newest first. (README §38)
            models.Index(
                fields=["recipient", "-created_at"], name="notification_user_idx"
            ),
            # The unread badge, which is polled far more often than the list is
            # opened. Partial, so it indexes only the rows the count scans.
            models.Index(
                fields=["recipient"],
                condition=Q(is_read=False),
                name="notification_unread_idx",
            ),
            models.Index(
                fields=["workspace", "-created_at"], name="notification_ws_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.type} for {self.recipient_id}"
