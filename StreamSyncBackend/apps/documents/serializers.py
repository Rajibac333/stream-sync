"""
Document representation.

Two shapes, matching `StreamSyncFrontend/src/api/documents.ts`:

  summary  the list row — no body, because a documents list that shipped every
           document's content would transfer megabytes to render titles
  detail   the editor's payload — summary plus `content` and `revision`
"""

from rest_framework import serializers

from apps.accounts.serializers import CollaboratorSerializer
from common.serializers import EmptyAsNullCharField

from .models import Document, DocumentVersion


class DocumentSummarySerializer(serializers.ModelSerializer):
    workspace_id = serializers.UUIDField(read_only=True)
    project_id = serializers.UUIDField(read_only=True, allow_null=True)
    project_name = serializers.SerializerMethodField()
    excerpt = EmptyAsNullCharField(read_only=True)
    author = CollaboratorSerializer(source="created_by", read_only=True)
    last_edited_by = CollaboratorSerializer(source="updated_by", read_only=True)
    collaborators = serializers.SerializerMethodField()
    active_collaborator_ids = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            "id",
            "workspace_id",
            "project_id",
            "project_name",
            "title",
            "excerpt",
            "author",
            "last_edited_by",
            "collaborators",
            "active_collaborator_ids",
            "updated_at",
            "created_at",
        ]
        read_only_fields = fields

    def get_project_name(self, document: Document) -> str | None:
        # select_related("project") in the view keeps this free.
        return document.project.name if document.project_id else None

    def get_collaborators(self, document: Document) -> list[dict]:
        """
        Everyone who has contributed to this document.

        Derived from the people on the record — its author, its last editor and
        the authors of its versions — rather than stored on a join table. There
        is no separate notion of "contributor" to maintain, and the set is
        exactly the union of those, so a table would be a second source of
        truth that could disagree.
        """
        people = {document.created_by_id: document.created_by}
        people[document.updated_by_id] = document.updated_by

        # Populated by prefetch_related in the view; absent means the
        # serializer is being used outside that queryset.
        for version in getattr(document, "prefetched_versions", []):
            people[version.created_by_id] = version.created_by

        return CollaboratorSerializer(list(people.values()), many=True).data

    def get_active_collaborator_ids(self, document: Document) -> list[str]:
        """
        Who is in the document right now.

        Always empty in this milestone. Presence is delivered over the
        WebSocket, which does not exist until Milestone 7 — so nobody is
        connected, and an empty list is the truthful answer rather than a
        placeholder. (README §42)
        """
        return []


class DocumentDetailSerializer(DocumentSummarySerializer):
    """The full record, including the body the editor loads."""

    class Meta(DocumentSummarySerializer.Meta):
        fields = [*DocumentSummarySerializer.Meta.fields, "content", "revision"]
        read_only_fields = fields


class DocumentVersionSerializer(serializers.ModelSerializer):
    """
    One entry in a document's history.

    The body is deliberately absent: a history list renders "Version 12 / Raj /
    10:42 AM / Added Apple Pay section", and shipping every snapshot's full
    text would make the list heavier than the document itself. Restore reads
    the content server-side, so no client ever needs it.
    """

    number = serializers.IntegerField(source="version_number", read_only=True)
    author = CollaboratorSerializer(source="created_by", read_only=True)
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = DocumentVersion
        fields = ["id", "number", "author", "summary", "is_current", "created_at"]
        read_only_fields = fields

    def get_is_current(self, version: DocumentVersion) -> bool:
        """
        Whether this is the version the editor is currently showing.

        Compared against a number the view supplies once for the whole page,
        rather than re-querying the maximum for every row.
        """
        return version.version_number == self.context.get("current_version_number")


class DocumentCreateSerializer(serializers.Serializer):
    """
    Creation input.

    `workspace_id` and `project_id` are validated against the caller's own
    access in the view; neither id is trusted as given. The author comes from
    the session, never the body.
    """

    workspace_id = serializers.UUIDField()
    title = serializers.CharField(max_length=200, trim_whitespace=True)
    project_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    content = serializers.CharField(
        required=False, allow_blank=True, default="", trim_whitespace=False
    )

    def validate_title(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Please enter a document title.")
        return value.strip()


class DocumentUpdateSerializer(serializers.Serializer):
    """
    Partial update.

    `workspace_id` is absent by design: moving a document between workspaces
    would carry it across a tenant boundary.
    """

    title = serializers.CharField(max_length=200, required=False, trim_whitespace=True)
    # trim_whitespace off — leading whitespace can be meaningful inside a body,
    # and trimming it would silently alter what the user typed.
    content = serializers.CharField(
        required=False, allow_blank=True, trim_whitespace=False
    )
    project_id = serializers.UUIDField(required=False, allow_null=True)

    # Optional optimistic-concurrency check. When present, the write is
    # rejected with 409 if someone else saved first.
    revision = serializers.IntegerField(required=False, min_value=1)

    # Describes the change for the version history — "Added Apple Pay section".
    # Applies only when `content` changes; a rename creates no version to
    # describe. Optional, because an autosaving editor has nothing to say.
    summary = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default=""
    )

    def validate_title(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Please enter a document title.")
        return value.strip()
