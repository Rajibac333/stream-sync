"""
Request validation and response shape for the AI endpoints.

Field names match `StreamSyncFrontend/src/api/ai.ts`.

Nothing here identifies the caller. There is no `actor_id`, and there will not
be one: the user comes from the authenticated session, and a client that can
name the actor can name somebody else — which for the confirmation endpoint
would mean creating tasks in another person's name. (README §16, §19)
"""

from rest_framework import serializers

from apps.tasks.models import TaskPriority

from .constants import (
    MAX_ACTION_ITEMS,
    MAX_CONTENT_LENGTH,
    MAX_QUESTION_LENGTH,
    MAX_REWRITE_LENGTH,
    AiAssigneeSource,
    AiRewriteMode,
    AiTone,
)

# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class DocumentOperationSerializer(serializers.Serializer):
    """
    The body shared by summarize, action-items and ask.

    `workspace_id` is accepted because the client sends it, and checked against
    the document rather than trusted: the document's own workspace is what
    governs access, so a mismatched id is a bug worth rejecting loudly rather
    than a permission the caller can claim.

    `content` is the unsaved editor body. Optional — without it the stored copy
    is used — and capped, so the assistant cannot be used as a way to push
    arbitrary volumes of text through the server.
    """

    document_id = serializers.UUIDField()
    workspace_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    content = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        default=None,
        max_length=MAX_CONTENT_LENGTH,
        trim_whitespace=False,
    )


class AskSerializer(DocumentOperationSerializer):
    question = serializers.CharField(max_length=MAX_QUESTION_LENGTH)

    def validate_question(self, value: str) -> str:
        question = value.strip()
        if not question:
            raise serializers.ValidationError("Please enter a question.")
        return question


class RewriteRequestSerializer(serializers.Serializer):
    """
    Input for `POST /api/ai/improve/`.

    `text` is plain text, never HTML — the frontend is explicit about this and
    so is the prompt. What comes back is inserted into a document, and a round
    trip that can carry markup is a round trip that can carry markup somebody
    else wrote.
    """

    document_id = serializers.UUIDField()
    text = serializers.CharField(max_length=MAX_REWRITE_LENGTH, trim_whitespace=False)
    mode = serializers.ChoiceField(choices=AiRewriteMode.choices)
    tone = serializers.ChoiceField(
        choices=AiTone.choices, required=False, allow_null=True, default=None
    )

    def validate_text(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Select some text to rewrite.")
        return value

    def validate(self, attrs: dict) -> dict:
        if attrs["mode"] == AiRewriteMode.TONE and not attrs.get("tone"):
            raise serializers.ValidationError(
                {"tone": "Choose a tone to rewrite the text in."}
            )
        # A tone sent with any other mode is dropped rather than rejected: it is
        # a leftover from the UI's previous selection, not an instruction.
        if attrs["mode"] != AiRewriteMode.TONE:
            attrs["tone"] = None
        return attrs


class ConfirmedActionItemSerializer(serializers.Serializer):
    """
    One action item as the user approved it.

    The client sends these *after* editing, and they are taken at face value —
    extraction is not re-run. That is the point of the confirmation step: what
    gets created is what was on screen when the button was pressed.
    """

    title = serializers.CharField(max_length=200, trim_whitespace=True)
    assignee_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    due_date = serializers.DateField(required=False, allow_null=True, default=None)
    priority = serializers.ChoiceField(
        choices=TaskPriority.choices, required=False, default=TaskPriority.MEDIUM
    )
    source_quote = serializers.CharField(
        max_length=1000, required=False, allow_blank=True, default=""
    )

    def validate_title(self, value: str) -> str:
        title = value.strip()
        if not title:
            raise serializers.ValidationError("A task needs a title.")
        return title


class ConfirmActionItemsSerializer(serializers.Serializer):
    """Input for `POST /api/ai/action-items/tasks/`."""

    document_id = serializers.UUIDField()
    workspace_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    # Required: a task belongs to a project (apps/tasks/models.py), and asking
    # the user which one is better than filing their work somewhere arbitrary.
    project_id = serializers.UUIDField()
    items = serializers.ListField(
        child=ConfirmedActionItemSerializer(),
        allow_empty=False,
        max_length=MAX_ACTION_ITEMS,
    )


# ---------------------------------------------------------------------------
# Responses
#
# Serialised from the dataclasses in schemas.py, so the OpenAPI schema and the
# runtime payload cannot drift apart.
# ---------------------------------------------------------------------------


class ProvenanceSerializer(serializers.Serializer):
    """
    Who produced this, and when.

    On every AI response. `engine` is the real identifier of whatever ran —
    a model id, or `mock-heuristic` when the deterministic fallback answered —
    because a UI that says "generated by AI" over rule-based string handling is
    a UI that has misled its user.
    """

    engine = serializers.CharField(read_only=True)
    generated_at = serializers.DateTimeField(read_only=True)


class SummarySerializer(ProvenanceSerializer):
    summary = serializers.CharField(read_only=True)
    key_points = serializers.ListField(child=serializers.CharField(), read_only=True)
    decisions = serializers.ListField(child=serializers.CharField(), read_only=True)


class ActionItemSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    title = serializers.CharField(read_only=True)
    assignee_id = serializers.UUIDField(read_only=True, allow_null=True)
    assignee_name = serializers.CharField(read_only=True, allow_null=True)
    assignee_source = serializers.ChoiceField(
        choices=AiAssigneeSource.choices, read_only=True
    )
    due_date = serializers.DateField(read_only=True, allow_null=True)
    priority = serializers.ChoiceField(choices=TaskPriority.choices, read_only=True)
    source_quote = serializers.CharField(read_only=True)
    source_section = serializers.CharField(read_only=True, allow_null=True)


class ActionItemsSerializer(ProvenanceSerializer):
    items = ActionItemSerializer(many=True, read_only=True)


class RewriteSerializer(ProvenanceSerializer):
    text = serializers.CharField(read_only=True)
    note = serializers.CharField(read_only=True)
    # False means the text was returned as it came in. Reported honestly rather
    # than hidden, so "already concise" reads as an answer instead of a
    # silently identical result.
    changed = serializers.BooleanField(read_only=True)


class CitationSerializer(serializers.Serializer):
    quote = serializers.CharField(read_only=True)
    section = serializers.CharField(read_only=True, allow_null=True)


class AnswerSerializer(ProvenanceSerializer):
    answer = serializers.CharField(read_only=True)
    citations = CitationSerializer(many=True, read_only=True)
    # False means the document does not cover the question — a real answer, and
    # the one the citation design exists to make possible.
    grounded = serializers.BooleanField(read_only=True)
