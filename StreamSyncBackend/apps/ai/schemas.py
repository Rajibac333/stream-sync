"""
The shape of an AI answer, and the check that it really is that shape.

Two things live here, and they are two halves of the same contract:

* the JSON Schemas handed to the provider, which constrain what it may emit;
* the parsers that turn a provider payload into typed results, which assume
  nothing and verify everything.

The second half is not redundant. Structured outputs make a malformed reply
unlikely, not impossible — a truncated response, a provider without schema
support, or a future mock that drifts all produce the same symptom. Validating
here means a bad payload becomes a 503 with a log line, never a 500 from
`KeyError` deep inside a serializer. (README §46)
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from uuid import UUID

from apps.tasks.models import TaskPriority

from .constants import (
    MAX_ACTION_ITEMS,
    MAX_CITATIONS,
    MAX_DECISIONS,
    MAX_KEY_POINTS,
    AiAssigneeSource,
)
from .errors import AiInvalidResponseError

# ---------------------------------------------------------------------------
# JSON Schemas
#
# Every object sets `additionalProperties: false` and lists every property in
# `required` — both are required by structured outputs, and both are what make
# the reply predictable enough to parse without guessing.
#
# Nullable fields use `anyOf` rather than a `["string", "null"]` type array,
# which the structured-output subset does not accept. Length and count limits
# are absent for the same reason: they are enforced below, after the fact.
# ---------------------------------------------------------------------------

_NULLABLE_STRING = {"anyOf": [{"type": "string"}, {"type": "null"}]}

SUMMARY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "key_points", "decisions"],
    "properties": {
        "summary": {
            "type": "string",
            "description": (
                "Two or three sentences describing what the document is about."
            ),
        },
        "key_points": {
            "type": "array",
            "description": "The most important points, each a short phrase.",
            "items": {"type": "string"},
        },
        "decisions": {
            "type": "array",
            "description": (
                "Choices the document records as settled. Empty when the "
                "document does not decide anything."
            ),
            "items": {"type": "string"},
        },
    },
}

ACTION_ITEMS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["items"],
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "title",
                    "assignee_name",
                    "assignee_source",
                    "due_date",
                    "priority",
                    "source_quote",
                    "source_section",
                ],
                "properties": {
                    "title": {
                        "type": "string",
                        "description": (
                            "The work to be done, phrased as an instruction."
                        ),
                    },
                    # A name, never an id. The model has no way to know a user's
                    # UUID, and inviting it to produce one invites it to invent
                    # one — which would assign somebody else's work to a
                    # stranger. Names are resolved against workspace membership
                    # server-side.
                    "assignee_name": _NULLABLE_STRING,
                    "assignee_source": {
                        "type": "string",
                        "enum": list(AiAssigneeSource.values),
                        "description": (
                            "'named' only when the document itself says this "
                            "person owns the work; otherwise 'suggested'."
                        ),
                    },
                    "due_date": {
                        "anyOf": [
                            {"type": "string", "format": "date"},
                            {"type": "null"},
                        ],
                        "description": "ISO date, only if the document states one.",
                    },
                    "priority": {
                        "type": "string",
                        "enum": list(TaskPriority.values),
                    },
                    # The verbatim sentence the item came from. This is what
                    # lets a user check a proposal against the document before
                    # it becomes somebody's task.
                    "source_quote": {"type": "string"},
                    "source_section": _NULLABLE_STRING,
                },
            },
        },
    },
}

REWRITE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["text", "note", "changed"],
    "properties": {
        "text": {
            "type": "string",
            "description": "The rewritten text, plain text only, no markup.",
        },
        "note": {
            "type": "string",
            "description": "One short sentence describing what was changed.",
        },
        "changed": {
            "type": "boolean",
            "description": (
                "False when the text was already fine and was returned "
                "unchanged. Say so rather than inventing an edit."
            ),
        },
    },
}

ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answer", "citations", "grounded"],
    "properties": {
        "answer": {"type": "string"},
        "citations": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["quote", "section"],
                "properties": {
                    "quote": {
                        "type": "string",
                        "description": "Verbatim text from the document.",
                    },
                    "section": _NULLABLE_STRING,
                },
            },
        },
        "grounded": {
            "type": "boolean",
            "description": (
                "False when the document does not answer the question. Then "
                "the answer must say so and cite nothing — never guess."
            ),
        },
    },
}


# ---------------------------------------------------------------------------
# Results
#
# What the service layer hands back. Frozen because a result is a record of one
# provider call and nothing downstream has any business editing it.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Provenance:
    """
    Who produced this answer, and when.

    Carried on every result and rendered by the UI. The `engine` is the real
    identifier of whatever ran — `mock-heuristic` when the deterministic
    fallback answered, the model id when a model did. Stamping a heuristic
    result with a model name would make every other claim the product makes
    about its AI untrustworthy, so the value is taken from the provider rather
    than from configuration.
    """

    engine: str
    generated_at: datetime


@dataclass(frozen=True)
class Summary(Provenance):
    summary: str
    key_points: list[str] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ActionItem:
    # Generated here, not by the model: the client needs a stable handle for
    # each proposal while the user edits it, and an id chosen by a model is not
    # one this system can vouch for.
    id: UUID
    title: str
    assignee_id: UUID | None
    assignee_name: str | None
    assignee_source: str
    due_date: date | None
    priority: str
    source_quote: str
    source_section: str | None


@dataclass(frozen=True)
class ActionItems(Provenance):
    items: list[ActionItem] = field(default_factory=list)


@dataclass(frozen=True)
class Rewrite(Provenance):
    text: str
    note: str
    changed: bool
    mode: str
    tone: str | None


@dataclass(frozen=True)
class Citation:
    quote: str
    section: str | None


@dataclass(frozen=True)
class Answer(Provenance):
    answer: str
    citations: list[Citation] = field(default_factory=list)
    grounded: bool = False


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def _require_mapping(payload: Any, where: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise AiInvalidResponseError(extra={"field": where, "reason": "not an object"})
    return payload


def _text(payload: dict[str, Any], key: str, *, required: bool = True) -> str:
    value = payload.get(key)
    if value is None and not required:
        return ""
    if not isinstance(value, str):
        raise AiInvalidResponseError(extra={"field": key, "reason": "not a string"})
    return value.strip()


def _optional_text(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise AiInvalidResponseError(extra={"field": key, "reason": "not a string"})
    return value.strip() or None


def _flag(payload: dict[str, Any], key: str) -> bool:
    value = payload.get(key)
    if not isinstance(value, bool):
        raise AiInvalidResponseError(extra={"field": key, "reason": "not a boolean"})
    return value


def _text_list(payload: dict[str, Any], key: str, limit: int) -> list[str]:
    value = payload.get(key, [])
    if value is None:
        return []
    if not isinstance(value, list):
        raise AiInvalidResponseError(extra={"field": key, "reason": "not an array"})

    items = [
        entry.strip() for entry in value if isinstance(entry, str) and entry.strip()
    ]
    return items[:limit]


def _optional_date(payload: dict[str, Any], key: str) -> date | None:
    value = payload.get(key)
    if not value:
        return None
    if not isinstance(value, str):
        raise AiInvalidResponseError(extra={"field": key, "reason": "not a string"})
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        # A date the model invented in the wrong format is dropped rather than
        # failing the whole extraction. Losing one due date costs the user a
        # field to fill in; losing the extraction costs them the feature.
        return None


def parse_summary(payload: Any, *, engine: str, generated_at: datetime) -> Summary:
    data = _require_mapping(payload, "summary")
    summary = _text(data, "summary")
    if not summary:
        raise AiInvalidResponseError(extra={"field": "summary", "reason": "empty"})

    return Summary(
        engine=engine,
        generated_at=generated_at,
        summary=summary,
        key_points=_text_list(data, "key_points", MAX_KEY_POINTS),
        decisions=_text_list(data, "decisions", MAX_DECISIONS),
    )


def parse_action_items(
    payload: Any,
    *,
    engine: str,
    generated_at: datetime,
    resolve_assignee,
    new_id,
) -> ActionItems:
    """
    Validate extracted items and resolve their owners.

    `resolve_assignee` maps a name to a workspace member; `new_id` mints the
    client-facing id. Both are injected so this function stays free of database
    access and can be tested against a payload alone.

    Items missing a title or a quote are dropped, not repaired. An item with no
    quote cannot be checked against the document, and an unverifiable proposal
    is worth less than one fewer proposal.
    """
    data = _require_mapping(payload, "action_items")
    raw_items = data.get("items", [])
    if not isinstance(raw_items, list):
        raise AiInvalidResponseError(extra={"field": "items", "reason": "not an array"})

    items: list[ActionItem] = []
    for raw in raw_items[:MAX_ACTION_ITEMS]:
        if not isinstance(raw, dict):
            continue

        title = _text(raw, "title", required=False)
        quote = _text(raw, "source_quote", required=False)
        if not title or not quote:
            continue

        name = _optional_text(raw, "assignee_name")
        assignee_id = resolve_assignee(name) if name else None

        source = raw.get("assignee_source")
        if source not in AiAssigneeSource.values:
            source = AiAssigneeSource.SUGGESTED
        # A proposal the document did not actually attribute is a suggestion,
        # whatever the model called it.
        if name is None:
            source = AiAssigneeSource.SUGGESTED

        priority = raw.get("priority")
        if priority not in TaskPriority.values:
            priority = TaskPriority.MEDIUM

        items.append(
            ActionItem(
                id=new_id(),
                title=title,
                assignee_id=assignee_id,
                assignee_name=name,
                assignee_source=source,
                due_date=_optional_date(raw, "due_date"),
                priority=priority,
                source_quote=quote,
                source_section=_optional_text(raw, "source_section"),
            )
        )

    return ActionItems(engine=engine, generated_at=generated_at, items=items)


def parse_rewrite(
    payload: Any,
    *,
    engine: str,
    generated_at: datetime,
    mode: str,
    tone: str | None,
    original: str,
) -> Rewrite:
    data = _require_mapping(payload, "rewrite")
    text = _text(data, "text")
    if not text:
        raise AiInvalidResponseError(extra={"field": "text", "reason": "empty"})

    changed = _flag(data, "changed")
    # The model's own account of whether it changed anything is checked against
    # the text it returned. Both directions of that lie are visible to the user
    # — "no changes needed" over a rewritten paragraph, or a diff-less result
    # presented as an improvement — so the comparison wins.
    actually_changed = text.strip() != original.strip()
    if changed != actually_changed:
        changed = actually_changed

    return Rewrite(
        engine=engine,
        generated_at=generated_at,
        text=text,
        note=_text(data, "note", required=False),
        changed=changed,
        mode=mode,
        tone=tone,
    )


def parse_answer(payload: Any, *, engine: str, generated_at: datetime) -> Answer:
    data = _require_mapping(payload, "answer")
    answer = _text(data, "answer")
    if not answer:
        raise AiInvalidResponseError(extra={"field": "answer", "reason": "empty"})

    grounded = _flag(data, "grounded")

    raw_citations = data.get("citations") or []
    if not isinstance(raw_citations, list):
        raise AiInvalidResponseError(
            extra={"field": "citations", "reason": "not an array"}
        )

    citations: list[Citation] = []
    for raw in raw_citations[:MAX_CITATIONS]:
        if not isinstance(raw, dict):
            continue
        quote = _text(raw, "quote", required=False)
        if quote:
            citations.append(
                Citation(quote=quote, section=_optional_text(raw, "section"))
            )

    # An ungrounded answer citing the document contradicts itself; the citations
    # are dropped so the UI cannot present sources for an "it doesn't say".
    if not grounded:
        citations = []

    return Answer(
        engine=engine,
        generated_at=generated_at,
        answer=answer,
        citations=citations,
        grounded=grounded,
    )
