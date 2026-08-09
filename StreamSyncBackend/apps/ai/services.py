"""
AI workflows.

The middle layer of the architecture the milestone specifies:

    API  →  AI service  →  provider

Views validate and authorise. This module decides what the assistant is asked,
turns the answer into typed results, and records what happened. Providers know
one vendor and nothing about StreamSync. No view imports a provider, and no
provider imports a model. (README §36, Milestone 9)

WHAT THIS LAYER GUARANTEES

* **Nothing is created without a person asking twice.** Extraction returns
  proposals; tasks exist only after a separate, explicit confirmation request.
  (README §45)
* **Failure is contained.** Every provider fault becomes a 503-family error
  with a clear code. A failed summary must not take the document editor with
  it. (README §46)
* **Logs record the operation, not the document.** Which operation ran, for
  which document, how long it took, which engine answered — never the content.
  (README §31, Milestone 9)
"""

import logging
import time
from typing import Any
from uuid import UUID, uuid4

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.activity import services as activity
from apps.activity.models import ActivityAction, EntityType
from apps.documents.models import Document
from apps.projects.models import Project
from apps.tasks import services as task_services
from apps.tasks.models import Task
from apps.workspaces.models import MembershipStatus, Workspace, WorkspaceMembership

from . import prompts, schemas
from .constants import AiOperation
from .errors import AiUnavailableError
from .providers import AiContext, AiRequest, get_provider
from .schemas import ActionItem, ActionItems, Answer, Rewrite, Summary
from .text import document_to_text, truncate

logger = logging.getLogger("streamsync.ai")


# ---------------------------------------------------------------------------
# Shared plumbing
# ---------------------------------------------------------------------------


class _Members:
    """
    The workspace roster, and the name → id mapping built from it.

    Loaded once per request. Resolution is by full name first and given name
    second, because a document says "Maria will design the checkout", not
    "Maria Alvarez (uuid) will". An ambiguous given name resolves to nobody:
    proposing the wrong Alex is worse than proposing no one, since the wrong
    Alex is the version a user might accept without noticing.
    """

    def __init__(self, workspace: Workspace) -> None:
        rows = (
            WorkspaceMembership.objects.filter(
                workspace=workspace, status=MembershipStatus.ACTIVE
            )
            .select_related("user")
            .values_list("user__id", "user__name")
        )

        self.names: list[str] = []
        self._by_full: dict[str, UUID] = {}
        given_counts: dict[str, int] = {}
        by_given: dict[str, UUID] = {}

        for user_id, name in rows:
            name = (name or "").strip()
            if not name:
                continue
            self.names.append(name)
            self._by_full[name.casefold()] = user_id

            given = name.split()[0].casefold()
            given_counts[given] = given_counts.get(given, 0) + 1
            by_given[given] = user_id

        self._by_given = {
            given: user_id
            for given, user_id in by_given.items()
            if given_counts[given] == 1
        }

    def resolve(self, name: str | None) -> UUID | None:
        if not name:
            return None
        key = name.strip().casefold()
        return self._by_full.get(key) or self._by_given.get(
            key.split()[0] if key else ""
        )


def _context_for(document: Document, content: str | None) -> tuple[str, bool]:
    """
    The text the assistant reads, and whether it is complete.

    `content` is the unsaved editor body when the client sent one. Preferring it
    over the stored copy is what lets the assistant answer about what is on the
    user's screen rather than about their last save — the reason
    StreamSyncFrontend/src/api/ai.ts sends it at all.
    """
    raw = content if content is not None else document.content
    return truncate(document_to_text(raw), settings.AI_MAX_DOCUMENT_CHARS)


def _run(request: AiRequest, *, document: Document | None, actor) -> tuple[Any, str]:
    """
    Call the provider and return `(payload, engine)`.

    Every exception is converted. The expected ones are already AI errors and
    pass through; anything else — a bug in a provider, a vendor exception that
    escaped its own translation — is logged and reported as an outage, because
    a 500 from the assistant would tell the user their document is broken when
    it is not.
    """
    provider = get_provider()
    started = time.monotonic()

    try:
        payload = provider.generate(request)
    except AiUnavailableError:
        # Already the right shape and already logged where it was raised.
        raise
    except Exception:
        logger.exception(
            "AI provider raised an unexpected error",
            extra={
                "operation": request.operation,
                "engine": provider.engine,
                "event": "ai.provider_unexpected_error",
            },
        )
        raise AiUnavailableError from None

    logger.info(
        "AI operation served",
        extra={
            "operation": request.operation,
            "engine": provider.engine,
            "document_id": str(document.id) if document else None,
            "workspace_id": str(document.workspace_id) if document else None,
            "actor_id": str(getattr(actor, "id", "")) or None,
            "duration_ms": int((time.monotonic() - started) * 1000),
            # Sizes, not text. Enough to explain a slow request; not enough to
            # reconstruct anybody's document from the log.
            "input_chars": len(request.prompt),
            "event": "ai.operation_served",
        },
    )

    return payload, provider.engine


def _record(document: Document, actor, *, operation: str, detail: str) -> None:
    """
    Add one entry to the workspace timeline.

    Only for operations that produce something a person acts on. A rewrite
    preview or a question asked and closed is not workspace history, and a feed
    that logs every keystroke of assistant use is a feed nobody reads.
    """
    activity.record(
        workspace=document.workspace,
        actor=actor,
        action=ActivityAction.AI_ACTION,
        entity_type=EntityType.DOCUMENT,
        entity_id=document.id,
        name=document.title,
        href=f"/app/workspaces/{document.workspace_id}/documents/{document.id}",
        context=detail,
        operation=operation,
    )


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------


def summarize(*, document: Document, actor, content: str | None = None) -> Summary:
    """Summarise a document. (README §14, frontend §48)"""
    text, truncated = _context_for(document, content)
    system, prompt = prompts.summarize_prompt(
        title=document.title, text=text, truncated=truncated
    )

    payload, engine = _run(
        AiRequest(
            operation=AiOperation.SUMMARIZE,
            system=system,
            prompt=prompt,
            schema=schemas.SUMMARY_SCHEMA,
            max_output_tokens=settings.AI_MAX_OUTPUT_TOKENS,
            context=AiContext(
                document_title=document.title,
                document_text=text,
                truncated=truncated,
            ),
        ),
        document=document,
        actor=actor,
    )

    result = schemas.parse_summary(payload, engine=engine, generated_at=timezone.now())
    _record(
        document, actor, operation=AiOperation.SUMMARIZE, detail="Generated a summary"
    )
    return result


def extract_action_items(
    *, document: Document, actor, content: str | None = None
) -> ActionItems:
    """
    Propose action items found in a document.

    Proposals only. Nothing here writes a Task, and nothing here may: the user
    reviews and edits the items, then calls `create_tasks_from_action_items`
    with what they approved. An assistant that silently created work for other
    people would be a product nobody could trust with a document. (README §45)
    """
    text, truncated = _context_for(document, content)
    members = _Members(document.workspace)
    today = timezone.localdate()

    system, prompt = prompts.action_items_prompt(
        title=document.title,
        text=text,
        truncated=truncated,
        people=members.names,
        today=today.isoformat(),
    )

    payload, engine = _run(
        AiRequest(
            operation=AiOperation.ACTION_ITEMS,
            system=system,
            prompt=prompt,
            schema=schemas.ACTION_ITEMS_SCHEMA,
            max_output_tokens=settings.AI_MAX_OUTPUT_TOKENS,
            context=AiContext(
                document_title=document.title,
                document_text=text,
                truncated=truncated,
                people=members.names,
                today=today,
            ),
        ),
        document=document,
        actor=actor,
    )

    result = schemas.parse_action_items(
        payload,
        engine=engine,
        generated_at=timezone.now(),
        resolve_assignee=members.resolve,
        new_id=uuid4,
    )

    _record(
        document,
        actor,
        operation=AiOperation.ACTION_ITEMS,
        detail=f"Extracted {len(result.items)} action items",
    )
    return result


def rewrite(
    *, document: Document, actor, text: str, mode: str, tone: str | None = None
) -> Rewrite:
    """
    Rewrite a selection: improve, shorten, expand or restate in a tone.

    Returns text; writes nothing. The user decides whether it replaces their
    selection, which is why no activity entry is recorded here — nothing has
    happened to the document yet.
    """
    system, prompt = prompts.rewrite_prompt(text=text, mode=mode, tone=tone)

    payload, engine = _run(
        AiRequest(
            operation=AiOperation.REWRITE,
            system=system,
            prompt=prompt,
            schema=schemas.REWRITE_SCHEMA,
            max_output_tokens=settings.AI_MAX_OUTPUT_TOKENS,
            context=AiContext(text=text, mode=mode, tone=tone),
        ),
        document=document,
        actor=actor,
    )

    return schemas.parse_rewrite(
        payload,
        engine=engine,
        generated_at=timezone.now(),
        mode=mode,
        tone=tone,
        original=text,
    )


def ask(
    *, document: Document, actor, question: str, content: str | None = None
) -> Answer:
    """Answer a question about one document, with citations. (frontend §47)"""
    text, truncated = _context_for(document, content)
    system, prompt = prompts.ask_prompt(
        title=document.title, text=text, truncated=truncated, question=question
    )

    payload, engine = _run(
        AiRequest(
            operation=AiOperation.ASK,
            system=system,
            prompt=prompt,
            schema=schemas.ANSWER_SCHEMA,
            max_output_tokens=settings.AI_MAX_OUTPUT_TOKENS,
            context=AiContext(
                document_title=document.title,
                document_text=text,
                truncated=truncated,
                question=question,
            ),
        ),
        document=document,
        actor=actor,
    )

    return schemas.parse_answer(payload, engine=engine, generated_at=timezone.now())


# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------


@transaction.atomic
def create_tasks_from_action_items(
    *,
    workspace: Workspace,
    project: Project,
    document: Document,
    actor,
    items: list[dict[str, Any]],
) -> list[Task]:
    """
    Turn confirmed action items into real tasks.

    THE POINT OF THIS FUNCTION BEING SEPARATE

    Extraction proposes; this creates. They are two endpoints and two user
    gestures because the milestone requires it, and the requirement is sound:
    an assistant that reads a sentence wrong and files it as work assigned to a
    colleague has done something the user cannot easily undo. (README §45)

    The items are taken from the request, *after* the user has edited them —
    extraction is not re-run here. Re-deriving the list server-side would let
    the assistant create something other than what was on screen when the user
    pressed the button, which is the same failure with an extra step.

    Atomic across the whole batch: a partial set of tasks from one confirmation
    would leave the user unsure which half exists.
    """
    tasks: list[Task] = []

    for item in items:
        tasks.append(
            task_services.create_task(
                workspace=workspace,
                project=project,
                creator=actor,
                title=item["title"],
                # The quote is carried into the description so the task keeps a
                # trail back to the sentence it came from. Six weeks later,
                # "why does this task exist?" has an answer.
                description=_description_for(item, document),
                priority=item.get("priority"),
                assignee=item.get("assignee"),
                due_date=item.get("due_date"),
            )
        )

    logger.info(
        "Tasks created from AI action items",
        extra={
            "workspace_id": str(workspace.id),
            "document_id": str(document.id),
            "project_id": str(project.id),
            "actor_id": str(actor.id),
            "count": len(tasks),
            "event": "ai.tasks_confirmed",
        },
    )

    _record(
        document,
        actor,
        operation=AiOperation.ACTION_ITEMS,
        detail=f"Created {len(tasks)} tasks from action items",
    )

    return tasks


def _description_for(item: dict[str, Any], document: Document) -> str:
    quote = (item.get("source_quote") or "").strip()
    if not quote:
        return ""
    return f'From "{document.title}":\n\n“{quote}”'


__all__ = [
    "ActionItem",
    "ActionItems",
    "Answer",
    "Rewrite",
    "Summary",
    "ask",
    "create_tasks_from_action_items",
    "extract_action_items",
    "rewrite",
    "summarize",
]
