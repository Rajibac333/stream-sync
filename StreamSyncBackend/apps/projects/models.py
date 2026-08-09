"""
Projects.

A project groups work inside a workspace. It owns no access rules of its own:
membership in the parent workspace is what grants access, so a project cannot
be shared with someone outside the team that owns it. (README §7)
"""

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.workspaces.models import Workspace
from common.models import BaseModel


class ProjectStatus(models.TextChoices):
    """
    Where a project is in its lifecycle.

    Lowercase values because they travel to the browser and the frontend's
    `ProjectStatus` union is lowercase
    (StreamSyncFrontend/src/types/project.ts).

    Note the union of two specifications: README §7 lists ACTIVE, ARCHIVED and
    COMPLETED, while the frontend already ships planning / active / on_hold /
    completed. Rejecting `planning` would break a UI that is already built, and
    omitting `archived` would contradict the backend spec, so both are
    supported. See SETUP.md — the frontend's PROJECT_STATUS_LABELS needs an
    `archived` entry before anything can be archived through the UI.
    """

    PLANNING = "planning", _("Planning")
    ACTIVE = "active", _("Active")
    ON_HOLD = "on_hold", _("On hold")
    COMPLETED = "completed", _("Completed")
    ARCHIVED = "archived", _("Archived")


class Project(BaseModel):
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="projects",
        verbose_name=_("workspace"),
    )

    name = models.CharField(_("name"), max_length=120)
    slug = models.SlugField(
        _("slug"),
        max_length=140,
        help_text=_("URL-safe identifier, unique within the workspace."),
    )
    description = models.TextField(
        _("description"), max_length=2000, blank=True, default=""
    )

    status = models.CharField(
        _("status"),
        max_length=12,
        choices=ProjectStatus.choices,
        default=ProjectStatus.PLANNING,
    )

    # Open-ended projects have no deadline; null rather than a sentinel date.
    due_date = models.DateField(_("due date"), null=True, blank=True)

    # PROTECT, matching Workspace.owner: accounts are deactivated rather than
    # deleted, and losing a project because its creator left would destroy
    # work belonging to the whole team.
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_projects",
        verbose_name=_("owner"),
    )

    class Meta:
        verbose_name = _("project")
        verbose_name_plural = _("projects")
        ordering = ["-updated_at", "id"]
        constraints = [
            # Scoped to the workspace, not global: two teams may each have a
            # project called "Website Redesign" without colliding.
            models.UniqueConstraint(
                fields=["workspace", "slug"],
                name="project_workspace_slug_unique",
            ),
        ]
        indexes = [
            # Every project query is workspace-scoped and ordered by recency,
            # so this composite serves the list endpoint directly. (README §38)
            models.Index(
                fields=["workspace", "-updated_at"], name="project_ws_updated_idx"
            ),
            models.Index(fields=["workspace", "status"], name="project_ws_status_idx"),
        ]

    def __str__(self) -> str:
        return self.name

    def get_workspace(self) -> Workspace:
        """
        Lets the shared workspace permission classes resolve this object.

        See common/permissions/workspace.py — the same classes then work for
        projects, documents and everything added later without modification.
        """
        return self.workspace
