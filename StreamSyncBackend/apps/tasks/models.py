"""
Tasks.

A unit of work inside a project. Access is governed by workspace membership,
like everything else in the product. (README §10)
"""

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.projects.models import Project
from apps.workspaces.models import Workspace
from common.models import BaseModel


class TaskStatus(models.TextChoices):
    """
    Board column. Values match the frontend's `TaskStatus` union
    (StreamSyncFrontend/src/types/task.ts).
    """

    TODO = "todo", _("Todo")
    IN_PROGRESS = "in_progress", _("In Progress")
    REVIEW = "review", _("Review")
    DONE = "done", _("Done")


class TaskPriority(models.TextChoices):
    LOW = "low", _("Low")
    MEDIUM = "medium", _("Medium")
    HIGH = "high", _("High")
    URGENT = "urgent", _("Urgent")


class Task(BaseModel):
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="tasks",
        verbose_name=_("workspace"),
    )

    # Required, and CASCADE — the opposite of Document.project, on purpose. A
    # document is a standalone artefact that outlives the folder it sat in; a
    # task is a unit of work *within* a project and means nothing without it.
    # The frontend types `projectId` as non-null for the same reason.
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="tasks",
        verbose_name=_("project"),
    )

    title = models.CharField(_("title"), max_length=200)
    description = models.TextField(
        _("description"), max_length=5000, blank=True, default=""
    )

    status = models.CharField(
        _("status"), max_length=12, choices=TaskStatus.choices, default=TaskStatus.TODO
    )
    priority = models.CharField(
        _("priority"),
        max_length=8,
        choices=TaskPriority.choices,
        default=TaskPriority.MEDIUM,
    )

    # SET_NULL: removing someone from the workspace must unassign their tasks,
    # not delete the work. The task becomes unassigned and stays on the board.
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_tasks",
        verbose_name=_("assignee"),
    )

    # PROTECT, matching the other authorship fields: accounts are deactivated
    # rather than deleted.
    creator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_tasks",
        verbose_name=_("creator"),
    )

    due_date = models.DateField(_("due date"), null=True, blank=True)

    # Set the first time the task enters DONE, cleared if it is reopened. Kept
    # separate from `updated_at` so "when was this finished?" survives later
    # edits to the task.
    completed_at = models.DateTimeField(_("completed at"), null=True, blank=True)

    class Meta:
        verbose_name = _("task")
        verbose_name_plural = _("tasks")
        ordering = ["-updated_at", "id"]
        indexes = [
            # The task list and the board: one workspace, newest first.
            models.Index(
                fields=["workspace", "-updated_at"], name="task_ws_updated_idx"
            ),
            # Board columns within a project. (README §38)
            models.Index(fields=["project", "status"], name="task_project_status_idx"),
            # "My tasks" and the dashboard's open-task count.
            models.Index(
                fields=["assignee", "status"], name="task_assignee_status_idx"
            ),
            models.Index(fields=["workspace", "status"], name="task_ws_status_idx"),
            # Upcoming deadlines on the dashboard.
            models.Index(fields=["workspace", "due_date"], name="task_ws_due_idx"),
        ]

    def __str__(self) -> str:
        return self.title

    def get_workspace(self) -> Workspace:
        """Lets the shared workspace permission classes resolve this object."""
        return self.workspace

    @property
    def is_done(self) -> bool:
        return self.status == TaskStatus.DONE
