"""
Activity representation.

Field names match `StreamSyncFrontend/src/api/activity.ts`. The verb and the
subject travel separately — `action` and `target` — rather than as a
pre-composed sentence, so the client can render the target as a real link and
the copy can be translated later without the backend reissuing history.
"""

from rest_framework import serializers

from apps.accounts.serializers import CollaboratorSerializer

from .models import Activity


class ActivityTargetSerializer(serializers.Serializer):
    """The thing an entry is about. Drives the icon and the link."""

    type = serializers.CharField()
    id = serializers.UUIDField()
    name = serializers.CharField()
    href = serializers.CharField(allow_null=True)


class ActivitySerializer(serializers.ModelSerializer):
    workspace_id = serializers.UUIDField(read_only=True)
    actor = serializers.SerializerMethodField()
    target = serializers.SerializerMethodField()
    context = serializers.SerializerMethodField()

    class Meta:
        model = Activity
        fields = [
            "id",
            "workspace_id",
            "action",
            "actor",
            "target",
            "context",
            "created_at",
        ]
        read_only_fields = fields

    def get_actor(self, entry: Activity) -> dict:
        """
        Never null, even after the account is gone.

        `actor` is SET_NULL so a departed account cannot pin the log in place,
        but the client types this as non-null. The name copied into metadata at
        write time is what makes the entry still readable — which is the whole
        reason it is copied.
        """
        if entry.actor_id is not None:
            return CollaboratorSerializer(entry.actor).data

        return {
            "id": None,
            "name": entry.metadata.get("actor_name") or "A former member",
            "avatar_url": None,
        }

    def get_target(self, entry: Activity) -> dict:
        return {
            "type": entry.entity_type,
            "id": str(entry.entity_id),
            "name": entry.metadata.get("name") or "",
            "href": entry.metadata.get("href"),
        }

    def get_context(self, entry: Activity) -> str | None:
        return entry.metadata.get("context") or None
