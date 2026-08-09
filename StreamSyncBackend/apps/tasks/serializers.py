"""
Task representation.

Field names match `StreamSyncFrontend/src/api/tasks.ts`.
"""

from rest_framework import serializers

from apps.accounts.serializers import CollaboratorSerializer
from common.serializers import EmptyAsNullCharField

from .models import Task, TaskPriority, TaskStatus


class TaskSerializer(serializers.ModelSerializer):
    workspace_id = serializers.UUIDField(read_only=True)
    project_id = serializers.UUIDField(read_only=True)
    project_name = serializers.SerializerMethodField()
    description = EmptyAsNullCharField(read_only=True)
    assignee = CollaboratorSerializer(read_only=True)
    comment_count = serializers.SerializerMethodField()
    labels = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "workspace_id",
            "project_id",
            "project_name",
            "title",
            "description",
            "status",
            "priority",
            "assignee",
            "due_date",
            "labels",
            "comment_count",
            "updated_at",
            "created_at",
        ]
        read_only_fields = fields

    def get_project_name(self, task: Task) -> str:
        # select_related("project") in the view keeps this free.
        return task.project.name

    def get_comment_count(self, task: Task) -> int:
        """Annotated by the view; the fallback keeps the serializer reusable."""
        return getattr(task, "comment_count", 0)

    def get_labels(self, task: Task) -> list[dict]:
        """
        Always empty for now.

        Labels are a workspace-level catalogue with their own endpoint in the
        frontend, and they are not part of README §10 or Milestone 5. The field
        is present so the client renders an empty label row rather than
        crashing on a missing key. See SETUP.md.
        """
        return []


class TaskCreateSerializer(serializers.Serializer):
    """
    Creation input.

    `creator` comes from the session. `workspace_id`, `project_id` and
    `assignee_id` are all validated against the caller's own access in the view
    and the service — none of them is trusted as given.
    """

    workspace_id = serializers.UUIDField()
    project_id = serializers.UUIDField()
    title = serializers.CharField(max_length=200, trim_whitespace=True)
    description = serializers.CharField(
        max_length=5000, required=False, allow_blank=True, allow_null=True, default=""
    )
    status = serializers.ChoiceField(
        choices=TaskStatus.choices, required=False, default=TaskStatus.TODO
    )
    priority = serializers.ChoiceField(
        choices=TaskPriority.choices, required=False, default=TaskPriority.MEDIUM
    )
    assignee_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    due_date = serializers.DateField(required=False, allow_null=True, default=None)

    def validate_title(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Please enter a task title.")
        return value.strip()

    def validate_description(self, value: str | None) -> str:
        return (value or "").strip()


class TaskUpdateSerializer(serializers.Serializer):
    """
    Partial update.

    Every field optional — the board patches `status` alone on every drag, and
    sending only what changed means two people editing different fields of the
    same task do not overwrite each other.
    """

    title = serializers.CharField(max_length=200, required=False, trim_whitespace=True)
    description = serializers.CharField(
        max_length=5000, required=False, allow_blank=True, allow_null=True
    )
    status = serializers.ChoiceField(choices=TaskStatus.choices, required=False)
    priority = serializers.ChoiceField(choices=TaskPriority.choices, required=False)
    assignee_id = serializers.UUIDField(required=False, allow_null=True)
    due_date = serializers.DateField(required=False, allow_null=True)

    def validate_title(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Please enter a task title.")
        return value.strip()

    def validate_description(self, value: str | None) -> str:
        return (value or "").strip()
