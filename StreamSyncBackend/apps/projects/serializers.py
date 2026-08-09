"""
Project representation.

Field names match the wire contract the frontend already codes against in
`StreamSyncFrontend/src/api/projects.ts`.
"""

from rest_framework import serializers

from apps.accounts.serializers import CollaboratorSerializer
from common.serializers import EmptyAsNullCharField

from .models import Project, ProjectStatus


class ProjectSerializer(serializers.ModelSerializer):
    workspace_id = serializers.UUIDField(read_only=True)
    description = EmptyAsNullCharField(read_only=True)
    members = serializers.SerializerMethodField()
    task_count = serializers.SerializerMethodField()
    completed_task_count = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id",
            "workspace_id",
            "name",
            "slug",
            "description",
            "status",
            "task_count",
            "completed_task_count",
            "due_date",
            "members",
            "updated_at",
            "created_at",
        ]
        read_only_fields = fields

    def get_members(self, project: Project) -> list[dict]:
        """
        Who can work on this project.

        There is no project-level membership: access to a project *is* access
        to its workspace (README §7), so the members are the workspace's active
        members. The view prefetches them, so this costs no query per row.
        """
        memberships = getattr(project.workspace, "active_memberships", None)
        if memberships is None:
            return []
        return CollaboratorSerializer(
            [membership.user for membership in memberships], many=True
        ).data

    def get_task_count(self, project: Project) -> int:
        """
        Annotated by the view's queryset, so this costs no query per project.

        The fallback keeps the serializer usable outside that queryset — a
        correctness path, not the expected one.
        """
        return getattr(project, "task_count", 0)

    def get_completed_task_count(self, project: Project) -> int:
        return getattr(project, "completed_task_count", 0)


class ProjectWriteSerializer(serializers.Serializer):
    """
    Create and update input.

    A plain Serializer, not a ModelSerializer: `owner`, `workspace` and `slug`
    must be decided by the server. A caller able to set `owner` could attribute
    a project to somebody else, and one able to set `workspace` could plant a
    project inside another tenant.
    """

    name = serializers.CharField(max_length=120, trim_whitespace=True)
    description = serializers.CharField(
        max_length=2000, required=False, allow_blank=True, allow_null=True, default=""
    )
    status = serializers.ChoiceField(
        choices=ProjectStatus.choices, required=False, default=ProjectStatus.PLANNING
    )
    due_date = serializers.DateField(required=False, allow_null=True, default=None)

    def validate_name(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Please enter a project name.")
        return value.strip()

    def validate_description(self, value: str | None) -> str:
        # The client sends null for "no description"; the column stores "".
        return (value or "").strip()


class ProjectCreateSerializer(ProjectWriteSerializer):
    """
    Creation input.

    `workspace_id` is in the body because the frontend posts to a flat
    `/api/projects/` rather than a nested route. It is validated against the
    caller's own workspaces in the view — the id itself is never trusted.
    """

    workspace_id = serializers.UUIDField()


class ProjectUpdateSerializer(serializers.Serializer):
    """Partial update. Every field optional; workspace and owner are not here."""

    name = serializers.CharField(max_length=120, required=False, trim_whitespace=True)
    description = serializers.CharField(
        max_length=2000, required=False, allow_blank=True, allow_null=True
    )
    status = serializers.ChoiceField(choices=ProjectStatus.choices, required=False)
    due_date = serializers.DateField(required=False, allow_null=True)

    def validate_name(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Please enter a project name.")
        return value.strip()

    def validate_description(self, value: str | None) -> str:
        return (value or "").strip()
