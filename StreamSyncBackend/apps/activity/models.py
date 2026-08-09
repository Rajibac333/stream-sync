"""
The workspace activity log.

Append-only: entries are written when something notable happens and are never
edited or deleted afterwards. An audit trail that can be rewritten is not an
audit trail. (README §12, §40)

The timeline *endpoint* is Milestone 6. This milestone establishes the record
and writes entries for task and comment operations.
"""

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.workspaces.models import Workspace
from common.models import BaseModel


class ActivityAction(models.TextChoices):
    """
    What happened.

    Values match the frontend's `ActivityAction` union
    (StreamSyncFrontend/src/types/activity.ts), which pairs each one with a
    verb phrase. The server sends the verb and the subject separately rather
    than a pre-composed sentence, so the client can render the target as a real
    link and the copy can be translated without reissuing history.
    """

    PROJECT_CREATED = "project_created", _("Project created")
    DOCUMENT_CREATED = "document_created", _("Document created")
    DOCUMENT_EDITED = "document_edited", _("Document edited")
    TASK_CREATED = "task_created", _("Task created")
    TASK_COMPLETED = "task_completed", _("Task completed")
    MEMBER_INVITED = "member_invited", _("Member invited")
    COMMENT_ADDED = "comment_added", _("Comment added")
    AI_ACTION = "ai_action", _("AI action")


class EntityType(models.TextChoices):
    """What kind of thing the entry is about. Drives the icon and the link."""

    PROJECT = "project", _("Project")
    DOCUMENT = "document", _("Document")
    TASK = "task", _("Task")
    MEMBER = "member", _("Member")
    COMMENT = "comment", _("Comment")


class Activity(BaseModel):
    """
    One entry in a workspace's timeline.

    The target is stored as a loose `(entity_type, entity_id)` pair rather than
    a foreign key, deliberately. A foreign key would either block deletion of
    the thing it describes or cascade the history away with it, and "Raj
    deleted the Checkout project" is precisely the entry that must survive the
    project's deletion.

    Because of that, the target's display name is copied into `metadata` at
    write time. Resolving it later would require the row to still exist.
    """

    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="activities",
        verbose_name=_("workspace"),
    )

    # SET_NULL, not PROTECT: a departed account should not pin the whole log in
    # place, and the entry stays meaningful with the actor's name in metadata.
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="activities",
        verbose_name=_("actor"),
    )

    action = models.CharField(
        _("action"), max_length=32, choices=ActivityAction.choices
    )

    entity_type = models.CharField(
        _("entity type"), max_length=16, choices=EntityType.choices
    )
    entity_id = models.UUIDField(_("entity id"))

    # Target name, link and any extra context. Self-contained by design — see
    # the class docstring. Never holds anything secret; this is read by every
    # member of the workspace. (README §31)
    metadata = models.JSONField(_("metadata"), default=dict, blank=True)

    class Meta:
        verbose_name = _("activity")
        verbose_name_plural = _("activities")
        # Newest first: a timeline is read from the top.
        ordering = ["-created_at", "-id"]
        indexes = [
            # The only query this table serves: one workspace's feed, newest
            # first. (README §38)
            models.Index(
                fields=["workspace", "-created_at"], name="activity_ws_created_idx"
            ),
            # "Everything that happened to this task", used by the task detail
            # panel in Milestone 6.
            models.Index(
                fields=["entity_type", "entity_id"], name="activity_entity_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.action} in {self.workspace_id}"

    def save(self, *args, **kwargs) -> None:
        """
        Allow the insert, refuse every update.

        Same guarantee as DocumentVersion, for the same reason: an append-only
        log that can be edited proves nothing.
        """
        if self._state.adding is False:
            raise ValueError("Activity records are append-only and cannot be edited.")
        super().save(*args, **kwargs)
