"""
Notification representation.

Field names match `StreamSyncFrontend/src/api/notifications.ts`: `body` for the
model's `message`, `read` for `is_read`.
"""

from rest_framework import serializers

from apps.accounts.serializers import CollaboratorSerializer
from common.serializers import EmptyAsNullCharField

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    body = EmptyAsNullCharField(source="message", read_only=True)
    href = EmptyAsNullCharField(read_only=True)
    read = serializers.BooleanField(source="is_read", read_only=True)
    actor = CollaboratorSerializer(read_only=True)

    class Meta:
        model = Notification
        fields = [
            "id",
            "type",
            "title",
            "body",
            "actor",
            "href",
            "created_at",
            "read",
        ]
        read_only_fields = fields


class NotificationUpdateSerializer(serializers.Serializer):
    """
    Update input.

    Only the read flag is writable — everything else was composed by the server
    when the event happened. A client that could edit `title` could rewrite its
    own history of what it was told.
    """

    read = serializers.BooleanField()
