"""
Vocabulary shared by the AI endpoints.

These are wire values, not display strings: each one matches a member of the
corresponding union in StreamSyncFrontend/src/types/ai.ts. They are
`TextChoices` even though this app stores nothing, because that gives
serializer validation and OpenAPI enums for free.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _


class AiOperation(models.TextChoices):
    """
    Which assistant action ran.

    Logged and written into the activity entry so "used AI on Payment
    Requirements" can say *what* was done without the timeline needing a
    separate verb per operation. (README §12, frontend §44)
    """

    SUMMARIZE = "summarize", _("Summarize document")
    ACTION_ITEMS = "action_items", _("Extract action items")
    REWRITE = "rewrite", _("Improve text")
    ASK = "ask", _("Ask about document")


class AiRewriteMode(models.TextChoices):
    """What `POST /api/ai/improve/` should do to the selected text."""

    IMPROVE = "improve", _("Improve")
    SHORTEN = "shorten", _("Shorten")
    EXPAND = "expand", _("Expand")
    TONE = "tone", _("Adjust tone")


class AiTone(models.TextChoices):
    """Target voice, meaningful only when the mode is `tone`."""

    PROFESSIONAL = "professional", _("Professional")
    FRIENDLY = "friendly", _("Friendly")
    DIRECT = "direct", _("Direct")


class AiAssigneeSource(models.TextChoices):
    """
    Where a proposed owner came from.

    The distinction is the whole reason the field exists: `named` means the
    document says this person owns it, `suggested` means the assistant is
    guessing. The UI labels them differently because turning a guess into
    somebody's task without saying so is how an assistant loses trust.
    """

    NAMED = "named", _("Named in the document")
    SUGGESTED = "suggested", _("Suggested by the assistant")


# Ceilings applied before anything reaches a provider. They bound cost and
# latency, and they stop a client from using the assistant as a way to push
# unbounded text through the server.
MAX_QUESTION_LENGTH = 500
MAX_REWRITE_LENGTH = 8000

# The unsaved editor body a client may send with a request. Matches the ceiling
# the WebSocket consumer applies to a document update
# (apps/collaboration/events.py), so the same document cannot be accepted on one
# transport and rejected on the other.
MAX_CONTENT_LENGTH = 1_000_000

# How much of a document the assistant is allowed to read. Longer bodies are
# truncated rather than rejected, and the prompt says so, so the model does not
# claim to have summarised a document it only saw the first half of.
DEFAULT_MAX_DOCUMENT_CHARS = 60_000

# Extraction is capped so a document full of bullet points cannot turn into a
# hundred proposed tasks the user has to review one by one.
MAX_ACTION_ITEMS = 12
MAX_KEY_POINTS = 6
MAX_DECISIONS = 6
MAX_CITATIONS = 4
