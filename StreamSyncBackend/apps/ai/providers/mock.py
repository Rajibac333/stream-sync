"""
The deterministic provider.

It reads the document and answers from it with rules — keyword overlap, marker
phrases, heading structure. It is not a language model and this module never
pretends otherwise: every result it produces is stamped `mock-heuristic`, which
is the same engine string the frontend's own fallback uses, so a UI showing
provenance says the true thing on both sides.

WHY THIS EXISTS

1. Development and CI run without provider credentials. Milestone 9 requires
   that no automated test makes an external AI call, and the reliable way to
   guarantee that is for the configured provider in those environments to have
   no network code in it at all.
2. It documents the contract. Anything the real provider is asked for, this
   answers in the same shape, so a schema change that breaks one breaks both.

The heuristics are intentionally simple. Making them cleverer would blur the
line between "fallback that is honest about being a fallback" and "an AI
feature", which is the line the product depends on.
"""

import re
from typing import Any

from apps.tasks.models import TaskPriority

from ..constants import (
    MAX_ACTION_ITEMS,
    MAX_CITATIONS,
    MAX_DECISIONS,
    MAX_KEY_POINTS,
    AiAssigneeSource,
    AiOperation,
    AiRewriteMode,
    AiTone,
)
from ..text import HEADING_PREFIX, sentences
from .base import AiRequest

MOCK_ENGINE = "mock-heuristic"

# Phrases that mark a settled choice rather than a discussion of one.
_DECISION_MARKERS = (
    "we will",
    "will use",
    "will be used",
    "decided",
    "agreed",
    "chosen",
    "going with",
    "confirmed",
    "approved",
)

# Phrases that mark work somebody has to do.
_ACTION_MARKERS = (
    "todo",
    "to do",
    "needs to",
    "need to",
    "should",
    "must",
    "will ",
    "implement",
    "build",
    "design",
    "write",
    "test",
    "review",
    "add ",
    "create",
    "migrate",
    "investigate",
    "follow up",
)

_URGENT_MARKERS = ("urgent", "asap", "critical", "blocker", "immediately")
_HIGH_MARKERS = ("important", "high priority", "priority", "before launch")
_LOW_MARKERS = ("nice to have", "eventually", "later", "if time", "optional")

# Hedges removed by `improve` and by the `direct` tone.
_HEDGES = (
    "i think ",
    "i believe ",
    "perhaps ",
    "maybe ",
    "it seems that ",
    "it seems ",
    "sort of ",
    "kind of ",
)
_FILLER = ("very ", "really ", "just ", "basically ", "actually ", "simply ")

_ISO_DATE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")

# Words too common to say anything about what a question is asking for.
_STOP_WORDS = frozenset(
    """a an and are as at be by do does for from how has have in is it its of on
    or that the this to was were what when where which who why will with you
    your our we us""".split()
)


class MockProvider:
    """Rule-based answers derived from the document itself."""

    engine = MOCK_ENGINE

    def generate(self, request: AiRequest) -> dict[str, Any]:
        handlers = {
            AiOperation.SUMMARIZE: self._summarize,
            AiOperation.ACTION_ITEMS: self._action_items,
            AiOperation.REWRITE: self._rewrite,
            AiOperation.ASK: self._ask,
        }
        handler = handlers.get(request.operation)
        if handler is None:  # pragma: no cover - guarded by serializer choices
            raise ValueError(f"Unsupported AI operation: {request.operation}")

        return handler(request)

    # -- summarize ---------------------------------------------------------

    def _summarize(self, request: AiRequest) -> dict[str, Any]:
        blocks = _blocks(request.context.document_text)
        prose = [line for line in blocks.body if not line.startswith("- ")]

        body_sentences = sentences(" ".join(prose))
        if body_sentences:
            summary = " ".join(body_sentences[:2])
        elif blocks.bullets:
            summary = (
                f"{request.context.document_title} lists {len(blocks.bullets)} points."
            )
        else:
            summary = f"{request.context.document_title} has no content yet."

        # Headings are the document's own outline, so they beat any phrase this
        # module could pick out. Bullets are the next best structure, and only
        # if there is neither does it fall back to sentences.
        if blocks.headings:
            key_points = blocks.headings[:MAX_KEY_POINTS]
        elif blocks.bullets:
            key_points = blocks.bullets[:MAX_KEY_POINTS]
        else:
            key_points = body_sentences[:MAX_KEY_POINTS]

        decisions = [
            sentence
            for sentence in body_sentences + blocks.bullets
            if _contains_any(sentence, _DECISION_MARKERS)
        ]

        return {
            "summary": summary,
            "key_points": key_points,
            "decisions": decisions[:MAX_DECISIONS],
        }

    # -- action items ------------------------------------------------------

    def _action_items(self, request: AiRequest) -> dict[str, Any]:
        context = request.context
        items: list[dict[str, Any]] = []

        for line, section in _lines_with_sections(context.document_text):
            if line.startswith(HEADING_PREFIX):
                continue

            candidates = [line[2:]] if line.startswith("- ") else sentences(line)
            for candidate in candidates:
                if len(items) >= MAX_ACTION_ITEMS:
                    break
                if not _contains_any(candidate, _ACTION_MARKERS):
                    continue

                name = _find_person(candidate, context.people)
                items.append(
                    {
                        "title": _as_title(candidate, name),
                        "assignee_name": name,
                        "assignee_source": (
                            AiAssigneeSource.NAMED
                            if name
                            else AiAssigneeSource.SUGGESTED
                        ),
                        "due_date": _find_date(candidate),
                        "priority": _guess_priority(candidate),
                        # Verbatim, so the user can find it in the document.
                        "source_quote": candidate,
                        "source_section": section,
                    }
                )

        return {"items": items}

    # -- improve -----------------------------------------------------------

    def _rewrite(self, request: AiRequest) -> dict[str, Any]:
        context = request.context
        original = context.text
        mode = context.mode

        if mode == AiRewriteMode.SHORTEN:
            text, note = _shorten(original)
        elif mode == AiRewriteMode.EXPAND:
            # There is no honest deterministic way to add content that is not
            # in the input. Padding it with filler would be a rewrite the user
            # did not ask for, dressed up as an improvement, so this says
            # plainly that it did nothing.
            text = original
            note = (
                "Expanding text requires a language model. No provider is "
                "configured, so the text is unchanged."
            )
        elif mode == AiRewriteMode.TONE:
            text, note = _retone(original, context.tone)
        else:
            text, note = _improve(original)

        return {"text": text, "note": note, "changed": text.strip() != original.strip()}

    # -- ask ---------------------------------------------------------------

    def _ask(self, request: AiRequest) -> dict[str, Any]:
        context = request.context
        terms = _keywords(context.question)

        scored: list[tuple[int, str, str | None]] = []
        for line, section in _lines_with_sections(context.document_text):
            if line.startswith(HEADING_PREFIX):
                continue
            for sentence in sentences(line.removeprefix("- ")):
                overlap = len(terms & _keywords(sentence))
                if overlap:
                    scored.append((overlap, sentence, section))

        if not scored:
            # The one answer this must never improvise. "The document does not
            # cover that" is useful; a plausible guess with no source behind it
            # is the failure mode the whole citation design exists to prevent.
            return {
                "answer": (f"{context.document_title} does not appear to cover that."),
                "citations": [],
                "grounded": False,
            }

        scored.sort(key=lambda entry: entry[0], reverse=True)
        best = scored[:MAX_CITATIONS]

        return {
            "answer": " ".join(sentence for _, sentence, _ in best[:2]),
            "citations": [
                {"quote": sentence, "section": section} for _, sentence, section in best
            ],
            "grounded": True,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _Blocks:
    __slots__ = ("body", "bullets", "headings")

    def __init__(
        self, headings: list[str], bullets: list[str], body: list[str]
    ) -> None:
        self.headings = headings
        self.bullets = bullets
        self.body = body


def _blocks(text: str) -> _Blocks:
    headings: list[str] = []
    bullets: list[str] = []
    body: list[str] = []

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith(HEADING_PREFIX):
            headings.append(line[len(HEADING_PREFIX) :].strip())
        elif line.startswith("- "):
            bullets.append(line[2:].strip())
        else:
            body.append(line)

    return _Blocks(headings, bullets, body)


def _lines_with_sections(text: str):
    """Yield each line paired with the heading it sits under."""
    section: str | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(HEADING_PREFIX):
            section = line[len(HEADING_PREFIX) :].strip()
        yield line, section


def _contains_any(text: str, markers: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in markers)


def _keywords(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {word for word in words if len(word) > 2 and word not in _STOP_WORDS}


def _find_person(text: str, people: list[str]) -> str | None:
    """
    The first workspace member named in the line.

    Matching against the real roster rather than any capitalised word is what
    keeps "Stripe will handle payments" from proposing a task for somebody
    called Stripe.
    """
    lowered = text.lower()
    for person in people:
        first = person.split()[0].lower() if person.split() else ""
        if person.lower() in lowered or (len(first) > 2 and first in lowered):
            return person
    return None


def _find_date(text: str) -> str | None:
    match = _ISO_DATE.search(text)
    return match.group(1) if match else None


def _guess_priority(text: str) -> str:
    if _contains_any(text, _URGENT_MARKERS):
        return TaskPriority.URGENT
    if _contains_any(text, _HIGH_MARKERS):
        return TaskPriority.HIGH
    if _contains_any(text, _LOW_MARKERS):
        return TaskPriority.LOW
    return TaskPriority.MEDIUM


def _as_title(text: str, name: str | None) -> str:
    """Trim the sentence into something that reads as a task title."""
    title = text.strip().rstrip(".")
    if name:
        # "Raj will implement Stripe" -> "implement Stripe": the owner is a
        # field on the task, not part of its name.
        for prefix in (f"{name} will ", f"{name}: ", f"{name} to ", f"{name} "):
            if title.lower().startswith(prefix.lower()):
                title = title[len(prefix) :]
                break

    title = title.strip()
    return (title[:1].upper() + title[1:])[:200] if title else text[:200]


def _match_case(original: str, result: str) -> str:
    """
    Restore the opening capital after a leading phrase is removed.

    Stripping "I think " off the front leaves "we should use Stripe", which is
    a sentence that starts in lower case — visibly machine-mangled in the one
    place the user is about to paste it into their document.
    """
    if original[:1].isupper() and result[:1].islower():
        return result[:1].upper() + result[1:]
    return result


def _strip_phrases(text: str, phrases: tuple[str, ...]) -> str:
    result = text
    for phrase in phrases:
        result = re.sub(re.escape(phrase), "", result, flags=re.IGNORECASE)
    return _match_case(text, " ".join(result.split()))


def _improve(text: str) -> tuple[str, str]:
    cleaned = _strip_phrases(text, _FILLER + _HEDGES)
    if cleaned and cleaned[-1] not in ".!?":
        cleaned = f"{cleaned}."

    if cleaned.strip() == text.strip():
        return text, "The text is already concise; nothing was changed."
    return cleaned, "Removed filler words and hedging."


def _shorten(text: str) -> tuple[str, str]:
    parts = sentences(text)
    if len(parts) <= 1:
        trimmed = " ".join(text.split())
        if trimmed == text.strip():
            return text, "The text is a single sentence and was left as it is."
        return trimmed, "Collapsed extra whitespace."

    keep = max(1, round(len(parts) * 0.6))
    return " ".join(parts[:keep]), f"Kept the first {keep} of {len(parts)} sentences."


def _retone(text: str, tone: str | None) -> tuple[str, str]:
    if tone == AiTone.PROFESSIONAL:
        result = text
        for contraction, expanded in (
            ("can't", "cannot"),
            ("won't", "will not"),
            ("don't", "do not"),
            ("didn't", "did not"),
            ("it's", "it is"),
            ("we're", "we are"),
        ):
            result = re.sub(
                re.escape(contraction), expanded, result, flags=re.IGNORECASE
            )
        return result, "Expanded contractions for a more formal register."

    if tone == AiTone.DIRECT:
        return _strip_phrases(text, _HEDGES), "Removed hedging."

    if tone == AiTone.FRIENDLY:
        result = text
        for expanded, contraction in (
            ("cannot", "can't"),
            ("will not", "won't"),
            ("do not", "don't"),
            ("it is", "it's"),
        ):
            result = re.sub(
                re.escape(expanded), contraction, result, flags=re.IGNORECASE
            )
        return result, "Used contractions for a warmer register."

    return text, "No tone was given, so the text is unchanged."
