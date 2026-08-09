"""
The provider seam.

Everything above this line — views, serializers, services — knows only
`AiProvider`. Everything below it knows one vendor. That is the whole point of
the abstraction the milestone asks for: swapping the provider, or running
without one, changes exactly one module and no endpoint. (README §14,
Milestone 9)

A request carries two representations of the same ask:

* `system` / `prompt` / `schema`, the rendered form a language model consumes;
* `context`, the structured form it was rendered from.

The duplication is deliberate. The deterministic provider cannot read a prompt
— it reads the document — and giving it the structured inputs is what lets it
answer without either faking a model or forcing every caller to know which
provider is installed.
"""

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Protocol, runtime_checkable


@dataclass(frozen=True)
class AiContext:
    """The structured inputs behind one operation."""

    document_title: str = ""
    document_text: str = ""
    # True when `document_text` is a prefix of a longer body. The prompt says so
    # too, because a model that thinks it has read everything will confidently
    # report that something is absent.
    truncated: bool = False

    # Ask.
    question: str = ""

    # Improve.
    text: str = ""
    mode: str = ""
    tone: str | None = None

    # Names of active workspace members, so a proposed owner is somebody who
    # actually exists on the team. Never ids: see ACTION_ITEMS_SCHEMA.
    people: list[str] = field(default_factory=list)

    # Passed in rather than read from the clock, so a due date the assistant
    # infers ("by Friday") resolves against the request's day and tests are
    # not time-dependent.
    today: date | None = None


@dataclass(frozen=True)
class AiRequest:
    operation: str
    system: str
    prompt: str
    schema: dict[str, Any]
    max_output_tokens: int
    context: AiContext


@runtime_checkable
class AiProvider(Protocol):
    """
    Something that can answer an `AiRequest` with JSON matching its schema.

    `engine` is the identifier stamped onto every result and shown to the user.
    It is a property of the implementation, never of configuration, so a
    heuristic answer cannot be labelled as a model's.

    Implementations raise only the exceptions in `apps.ai.errors`. Vendor
    exceptions must not escape: they carry request and header material, and one
    of those headers is the API key.
    """

    engine: str

    def generate(self, request: AiRequest) -> dict[str, Any]:
        """Return the parsed JSON object. Never a string, never None."""
        ...
