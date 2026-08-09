"""
Workspaces and membership.

A workspace is the top-level tenant boundary in StreamSync: every project,
document, task and comment added in later milestones hangs off one, and
membership in it is the single question every future permission check reduces
to. (README §6, §20)
"""

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from common.models import BaseModel


class WorkspaceRole(models.TextChoices):
    """
    What a member may do.

    Stored lowercase because these values travel to the browser and the
    frontend's `WorkspaceRole` union is lowercase
    (StreamSyncFrontend/src/types/auth.ts). Keeping the wire format and the
    stored format identical removes a translation layer that would otherwise
    need to exist in every serializer.
    """

    OWNER = "owner", _("Owner")
    EDITOR = "editor", _("Editor")
    VIEWER = "viewer", _("Viewer")


# The roles that may be handed out. Owner is absent by design: ownership is
# transferred, never granted, so a workspace always has exactly one owner.
# Defined once here rather than inline in each serializer so the API schema
# gets a single stable enum name instead of a generated one.
ASSIGNABLE_ROLE_CHOICES = [
    (WorkspaceRole.EDITOR, WorkspaceRole.EDITOR.label),
    (WorkspaceRole.VIEWER, WorkspaceRole.VIEWER.label),
]


class MembershipStatus(models.TextChoices):
    """
    Whether the person has accepted their invitation.

    An invitation is a membership row rather than a separate resource. An
    invited person already occupies a seat, counts toward the member total and
    is removed exactly like an active member — modelling it separately would
    mean two lists, two removal paths and a distinction the UI would have to
    explain.
    """

    ACTIVE = "active", _("Active")
    INVITED = "invited", _("Invited")


class Workspace(BaseModel):
    """A tenant. Everything a team creates lives inside one."""

    name = models.CharField(_("name"), max_length=100)
    slug = models.SlugField(
        _("slug"),
        max_length=120,
        unique=True,
        help_text=_("URL-safe identifier. Assigned at creation and never changes."),
    )
    description = models.TextField(
        _("description"),
        max_length=500,
        blank=True,
        default="",
    )

    # PROTECT, not CASCADE: deleting a user must not silently destroy a
    # workspace that other people are actively working in. Ownership has to be
    # transferred first, which is a deliberate decision rather than a
    # side-effect of account deletion.
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_workspaces",
        verbose_name=_("owner"),
    )

    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="WorkspaceMembership",
        # WorkspaceMembership points at User twice — once for the member and
        # once for whoever invited them — so the pair has to be named.
        through_fields=("workspace", "user"),
        related_name="workspaces",
        verbose_name=_("members"),
    )

    class Meta:
        verbose_name = _("workspace")
        verbose_name_plural = _("workspaces")
        ordering = ["name"]
        indexes = [
            models.Index(fields=["owner"], name="workspace_owner_idx"),
        ]

    def __str__(self) -> str:
        return self.name


class WorkspaceMembershipQuerySet(models.QuerySet):
    def active(self) -> "WorkspaceMembershipQuerySet":
        return self.filter(status=MembershipStatus.ACTIVE)

    def invited(self) -> "WorkspaceMembershipQuerySet":
        return self.filter(status=MembershipStatus.INVITED)


class WorkspaceMembership(BaseModel):
    """
    One person's relationship to one workspace.

    This table is the authorization boundary. Every permission check in this
    milestone, and every workspace-scoped query in the milestones after it,
    resolves to "is there a row here for this user and this workspace, and what
    is its role?" (README §20, §37)
    """

    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="memberships",
        verbose_name=_("workspace"),
    )
    # CASCADE here is correct where PROTECT was correct on Workspace.owner:
    # a deleted account should stop being a member, and losing that row
    # destroys nothing anyone else was working on.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="workspace_memberships",
        verbose_name=_("user"),
    )

    role = models.CharField(
        _("role"),
        max_length=10,
        choices=WorkspaceRole.choices,
        default=WorkspaceRole.VIEWER,
    )
    status = models.CharField(
        _("status"),
        max_length=10,
        choices=MembershipStatus.choices,
        default=MembershipStatus.INVITED,
    )

    # Null while the invitation is outstanding. `created_at` records when the
    # row was made (the invitation), so both moments remain available.
    joined_at = models.DateTimeField(_("joined at"), null=True, blank=True)

    # SET_NULL rather than CASCADE: the inviter leaving the company must not
    # delete the memberships of everyone they invited.
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sent_workspace_invitations",
        verbose_name=_("invited by"),
    )

    objects = WorkspaceMembershipQuerySet.as_manager()

    class Meta:
        verbose_name = _("workspace membership")
        verbose_name_plural = _("workspace memberships")
        ordering = ["-created_at"]
        constraints = [
            # README §6. Also the reason an invitation is a membership: it
            # makes "invited twice" and "invited while already a member"
            # impossible at the database level rather than by convention.
            models.UniqueConstraint(
                fields=["workspace", "user"],
                name="workspace_member_unique",
            ),
        ]
        indexes = [
            # Serves "which workspaces am I in?", run on nearly every request
            # once workspace-scoped resources exist. (README §38)
            models.Index(fields=["user", "status"], name="membership_user_status_idx"),
            models.Index(
                fields=["workspace", "status"], name="membership_ws_status_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user} in {self.workspace} ({self.role})"

    @property
    def is_active_member(self) -> bool:
        return self.status == MembershipStatus.ACTIVE
