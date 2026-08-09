"""
Documents and their version history.

A document belongs to a workspace and may optionally belong to a project.
Access is governed by workspace membership — a document cannot be reached by
someone outside the team that owns it. (README §8, §9)
"""

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.projects.models import Project
from apps.workspaces.models import Workspace
from common.models import BaseModel

# How much of the body is kept as a list preview. Long enough to be useful,
# short enough that a list of 25 stays small.
EXCERPT_LENGTH = 200


class Document(BaseModel):
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="documents",
        verbose_name=_("workspace"),
    )

    # Optional, and SET_NULL rather than CASCADE: deleting a project must not
    # destroy the documents written inside it. They become unfiled and stay
    # reachable from the workspace. (README §8)
    project = models.ForeignKey(
        Project,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="documents",
        verbose_name=_("project"),
    )

    title = models.CharField(_("title"), max_length=200)

    # HTML rather than the editor's JSON: it stays readable in the database and
    # survives being rendered by something that is not Tiptap — an email
    # digest, a PDF export, a search indexer — instead of pinning the stored
    # format to one library's internal schema version.
    content = models.TextField(_("content"), blank=True, default="")

    # Denormalised so the list endpoint can `defer("content")`. Recomputed by
    # the service on every content change; never set directly.
    excerpt = models.CharField(
        _("excerpt"), max_length=EXCERPT_LENGTH, blank=True, default=""
    )

    # Incremented on every content write. The client sends the revision it
    # based its edit on, which is what makes a stale overwrite detectable
    # rather than silent.
    revision = models.PositiveIntegerField(_("revision"), default=1)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_documents",
        verbose_name=_("created by"),
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="updated_documents",
        verbose_name=_("last edited by"),
    )

    class Meta:
        verbose_name = _("document")
        verbose_name_plural = _("documents")
        ordering = ["-updated_at", "id"]
        indexes = [
            # The documents list: scoped to a workspace, most recent first.
            # (README §38)
            models.Index(
                fields=["workspace", "-updated_at"], name="document_ws_updated_idx"
            ),
            # The project detail page's documents tab.
            models.Index(
                fields=["project", "-updated_at"], name="document_project_updated_idx"
            ),
        ]

    def __str__(self) -> str:
        return self.title

    def get_workspace(self) -> Workspace:
        """Lets the shared workspace permission classes resolve this object."""
        return self.workspace


class DocumentVersion(BaseModel):
    """
    An immutable snapshot of a document's body.

    Append-only by construction: `save()` refuses to modify a row that already
    exists. History that can be edited is not history, and version restore in
    Milestone 6 works by writing a *new* version rather than rewriting an old
    one. (README §9, §39)
    """

    document = models.ForeignKey(
        Document,
        on_delete=models.CASCADE,
        related_name="versions",
        verbose_name=_("document"),
    )

    # Human-facing counter — "Version 12" — scoped per document, unlike the id.
    version_number = models.PositiveIntegerField(_("version number"))

    content = models.TextField(_("content"), blank=True, default="")

    summary = models.CharField(
        _("summary"),
        max_length=200,
        blank=True,
        default="",
        help_text=_('One line describing the change, e.g. "Added Apple Pay section".'),
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="document_versions",
        verbose_name=_("created by"),
    )

    class Meta:
        verbose_name = _("document version")
        verbose_name_plural = _("document versions")
        # Newest first: the version list is read far more often than it is
        # walked forwards.
        ordering = ["-version_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["document", "version_number"],
                name="document_version_number_unique",
            ),
        ]
        indexes = [
            models.Index(
                fields=["document", "-version_number"],
                name="version_document_number_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.document} v{self.version_number}"

    def save(self, *args, **kwargs) -> None:
        """
        Allow the insert, refuse every update.

        Enforced here rather than by convention because "immutable" is a
        guarantee the rest of the system relies on — restore, audit trails and
        the activity feed are all meaningless if a version can be rewritten.
        """
        if self._state.adding is False:
            raise ValueError(
                "Document versions are immutable. Create a new version instead."
            )
        super().save(*args, **kwargs)
