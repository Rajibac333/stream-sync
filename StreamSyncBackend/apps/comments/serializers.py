"""
Comment representation.

Field names match `StreamSyncFrontend/src/api/comments.ts`. A thread is
returned as a root with its replies nested one level deep.
"""

from rest_framework import serializers

from apps.accounts.serializers import CollaboratorSerializer

from .models import Comment, CommentResource


class CommentReplySerializer(serializers.ModelSerializer):
    """A reply. Deliberately has no `replies` of its own — threads are flat."""

    author = CollaboratorSerializer(read_only=True)

    class Meta:
        model = Comment
        fields = ["id", "author", "body", "mentions", "created_at", "edited_at"]
        read_only_fields = fields


class CommentSerializer(serializers.ModelSerializer):
    """A thread root, with its replies."""

    resource_type = serializers.CharField(read_only=True)
    resource_id = serializers.UUIDField(read_only=True)
    author = CollaboratorSerializer(read_only=True)
    resolved = serializers.BooleanField(source="is_resolved", read_only=True)
    quoted_text = serializers.SerializerMethodField()
    replies = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = [
            "id",
            "resource_type",
            "resource_id",
            "author",
            "body",
            "mentions",
            "quoted_text",
            "resolved",
            "created_at",
            "edited_at",
            "replies",
        ]
        read_only_fields = fields

    def get_quoted_text(self, comment: Comment) -> str | None:
        # The client branches on null to decide whether to render the quote
        # block at all.
        return comment.quoted_text or None

    def get_replies(self, comment: Comment) -> list[dict]:
        """
        Prefetched by the view, so this costs no query per thread.

        Falls back to the relation when the serializer is used outside that
        queryset — a correctness fallback, not the expected path.
        """
        replies = getattr(comment, "prefetched_replies", None)
        if replies is None:
            replies = comment.replies.select_related("author").order_by("created_at")
        return CommentReplySerializer(replies, many=True).data


class CommentCreateSerializer(serializers.Serializer):
    """
    Creation input.

    The author comes from the session. `mention_ids` are validated against
    workspace membership in the service — unknown ids are dropped rather than
    rejected, so a stale client cannot lose someone's comment.
    """

    resource_type = serializers.ChoiceField(choices=CommentResource.choices)
    resource_id = serializers.UUIDField()
    body = serializers.CharField(max_length=5000, trim_whitespace=True)
    mention_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        allow_empty=True,
        default=list,
        # A bound on how many mentions one comment can carry, so a single
        # request cannot force an unbounded membership query.
        max_length=50,
    )
    quoted_text = serializers.CharField(
        max_length=500, required=False, allow_blank=True, allow_null=True, default=""
    )

    def validate_body(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("A comment cannot be empty.")
        return value.strip()

    def validate_quoted_text(self, value: str | None) -> str:
        return (value or "").strip()


class CommentReplyCreateSerializer(serializers.Serializer):
    """Reply input. The resource is inherited from the thread, never sent."""

    body = serializers.CharField(max_length=5000, trim_whitespace=True)
    mention_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        allow_empty=True,
        default=list,
        max_length=50,
    )

    def validate_body(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("A reply cannot be empty.")
        return value.strip()


class CommentUpdateSerializer(serializers.Serializer):
    """
    Update input.

    Two distinct operations share this endpoint because the frontend PATCHes
    both: `body` is an edit (author only) and `resolved` is a workflow action
    (any editor, or the thread's author). The view applies the right rule to
    whichever field is present.
    """

    body = serializers.CharField(max_length=5000, required=False, trim_whitespace=True)
    resolved = serializers.BooleanField(required=False)

    def validate_body(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("A comment cannot be empty.")
        return value.strip()

    def validate(self, attrs: dict) -> dict:
        if not attrs:
            raise serializers.ValidationError(
                "Provide `body` to edit the comment or `resolved` to change its state."
            )
        return attrs
