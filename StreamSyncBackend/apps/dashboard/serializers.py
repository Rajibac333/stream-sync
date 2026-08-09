"""
Dashboard representation.

Field names match `StreamSyncFrontend/src/api/activity.ts` (`dashboardApi`).
"""

from rest_framework import serializers

from apps.accounts.serializers import CollaboratorSerializer

PRESENCE_STATUSES = ["online", "idle", "offline"]


class CollaboratorPresenceSerializer(serializers.Serializer):
    user = CollaboratorSerializer(read_only=True)
    # Derived from recent activity, not from a live socket — see services.py.
    # The field is named for what the UI shows, and the docstring is where the
    # weaker guarantee is recorded.
    status = serializers.ChoiceField(choices=PRESENCE_STATUSES, read_only=True)
    activity = serializers.CharField(read_only=True, allow_null=True)


class DashboardSummarySerializer(serializers.Serializer):
    active_project_count = serializers.IntegerField(read_only=True)
    open_task_count = serializers.IntegerField(read_only=True)
    due_today_count = serializers.IntegerField(read_only=True)
    completed_this_week_count = serializers.IntegerField(read_only=True)
    collaborators = CollaboratorPresenceSerializer(many=True, read_only=True)
