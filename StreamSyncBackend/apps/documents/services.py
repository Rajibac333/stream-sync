"""
Document workflows.

Creating a document is two writes that must not come apart, and editing one
touches four fields plus a counter, so both live here rather than in a view.
(README §21, §36)
"""

import logging
import re
from datetime import timedelta
from html import unescape

from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from django.utils.html import strip_tags

from apps.activity import services as activity
from apps.activity.models import Activity, ActivityAction, EntityType
from apps.projects.models import Project
from apps.workspaces.models import Workspace
from common.exceptions import ApplicationError, ConflictError, ErrorCode

from .models import EXCERPT_LENGTH, Document, DocumentVersion

logger = logging.getLogger("streamsync.documents")

# How long one person's edits to one document collapse into a single feed
# entry. Versions still capture every save — this only de-duplicates the
# *timeline*, which is otherwise unreadable during an editing session.
EDIT_ACTIVITY_WINDOW = timedelta(minutes=10)

# Tags that imply a line or paragraph break. Only these become whitespace when
# flattening a body to text — see build_excerpt.
_BLOCK_TAG = re.compile(
    r"</?(?:p|div|br|hr|h[1-6]|li|ul|ol|dl|dt|dd|table|thead|tbody|tr|td|th"
    r"|blockquote|pre|section|article|aside|header|footer|figure|figcaption)\b[^>]*>",
    re.IGNORECASE,
)


class ProjectNotInWorkspaceError(ApplicationError):
    """
    Filing a document under a project belonging to a different workspace.

    Rejected rather than ignored: silently dropping the project would leave the
    user's document somewhere they did not expect, and honouring it would put a
    document from one tenant inside another's project. (README §16)
    """

    status_code = 400
    default_code = ErrorCode.VALIDATION_ERROR
    default_detail = "That project does not belong to this workspace."


class VersionNotFoundError(ApplicationError):
    """A version id that does not belong to the document it was requested on."""

    status_code = 404
    default_code = ErrorCode.NOT_FOUND
    default_detail = "That version does not belong to this document."


class StaleDocumentError(ConflictError):
    """
    The edit was based on a revision that is no longer current.

    Someone else saved while this client was editing. Returning 409 lets the
    client reconcile instead of silently discarding the other person's work.
    """

    default_code = "DOCUMENT_REVISION_CONFLICT"
    default_detail = (
        "This document changed while you were editing. "
        "Reload to see the latest version."
    )


def build_excerpt(content: str) -> str:
    """
    A plain-text preview of the body.

    Tags are stripped because the stored body is HTML and a list preview that
    began mid-`<p>` would render markup at the user.

    Block tags become a *space*; inline tags are simply removed. `strip_tags`
    alone turns "<h1>Title</h1><p>Body</p>" into "TitleBody", running one
    block's last word into the next one's first. Spacing *every* tag overshoots
    the other way and turns "Body <strong>text</strong>." into "Body text .",
    so only tags that imply a break contribute whitespace.

    strip_tags still runs afterwards to remove the inline tags and anything
    malformed, and entities are unescaped so the preview reads as text rather
    than "&amp;".
    """
    spaced = _BLOCK_TAG.sub(" ", content or "")
    text = unescape(strip_tags(spaced))

    # Collapse runs of whitespace so an editor's indentation does not consume
    # the whole excerpt.
    return " ".join(text.split())[:EXCERPT_LENGTH]


def _document_href(document: Document) -> str:
    return f"/app/workspaces/{document.workspace_id}/documents/{document.id}"


def _record_edit(*, document: Document, actor) -> None:
    """
    Log an edit to the timeline, at most once per person per window.

    A feed with forty "Maria edited Payment Requirements" entries from one
    afternoon is a feed nobody reads. Version history is the complete record;
    this is the human summary of it.
    """
    recent = Activity.objects.filter(
        entity_type=EntityType.DOCUMENT,
        entity_id=document.id,
        action=ActivityAction.DOCUMENT_EDITED,
        actor=actor,
        created_at__gte=timezone.now() - EDIT_ACTIVITY_WINDOW,
    ).exists()

    if recent:
        return

    activity.record(
        workspace=document.workspace,
        actor=actor,
        action=ActivityAction.DOCUMENT_EDITED,
        entity_type=EntityType.DOCUMENT,
        entity_id=document.id,
        name=document.title,
        href=_document_href(document),
    )


def _resolve_project(workspace: Workspace, project: Project | None) -> Project | None:
    """Guard the workspace boundary on the project link."""
    if project is None:
        return None
    if project.workspace_id != workspace.id:
        raise ProjectNotInWorkspaceError
    return project


@transaction.atomic
def create_document(
    *,
    workspace: Workspace,
    author,
    title: str,
    content: str = "",
    project: Project | None = None,
) -> Document:
    """
    Create a document together with version 1.

    Atomic, and deliberately so: a document whose history begins at version 2
    has lost its original state permanently, and there is nothing later that
    could reconstruct it. Either both rows exist or neither does. (README §21)
    """
    project = _resolve_project(workspace, project)

    document = Document.objects.create(
        workspace=workspace,
        project=project,
        title=title,
        content=content,
        excerpt=build_excerpt(content),
        revision=1,
        created_by=author,
        updated_by=author,
    )

    DocumentVersion.objects.create(
        document=document,
        version_number=1,
        content=content,
        summary="Document created",
        created_by=author,
    )

    activity.record(
        workspace=workspace,
        actor=author,
        action=ActivityAction.DOCUMENT_CREATED,
        entity_type=EntityType.DOCUMENT,
        entity_id=document.id,
        name=document.title,
        href=_document_href(document),
        context=project.name if project else None,
    )

    logger.info(
        "Document created",
        extra={
            "workspace_id": str(workspace.id),
            "document_id": str(document.id),
            "user_id": str(author.id),
            "event": "document.created",
        },
    )

    return document


@transaction.atomic
def update_document(
    *,
    document: Document,
    editor,
    expected_revision: int | None = None,
    summary: str = "",
    **fields,
) -> Document:
    """
    Apply a partial update, snapshotting the body when it changes.

    `expected_revision` is optional. When supplied, a mismatch means another
    client saved in the meantime and the write is rejected rather than allowed
    to overwrite them.

    Every content change appends an immutable version, so the history is
    complete rather than a sample. Renaming or refiling does not — those do not
    change the text there would be anything to restore.
    """
    content_changed = "content" in fields and fields["content"] != document.content

    if content_changed:
        # Take the row lock *before* reading the revision, so a concurrent
        # writer cannot slip between the check and the write. Everything that
        # appends a version to this document serialises here — see
        # `next_version_number` for why that matters.
        document = lock_document(document.pk)

    if expected_revision is not None and expected_revision != document.revision:
        raise StaleDocumentError

    updates: list[str] = []

    if "title" in fields:
        document.title = fields["title"]
        updates.append("title")

    if "project" in fields:
        document.project = _resolve_project(document.workspace, fields["project"])
        updates.append("project")

    if content_changed:
        document.content = fields["content"]
        document.excerpt = build_excerpt(document.content)
        # Only a body change advances the revision. Renaming a document does
        # not invalidate an edit someone else is composing.
        document.revision += 1
        updates.extend(["content", "excerpt", "revision"])

    if not updates:
        return document

    document.updated_by = editor
    updates.extend(["updated_by", "updated_at"])

    document.save(update_fields=updates)

    if content_changed:
        append_version(
            document=document,
            author=editor,
            content=document.content,
            summary=summary or "Edited the document",
        )

        _record_edit(document=document, actor=editor)

    logger.info(
        "Document updated",
        extra={
            "workspace_id": str(document.workspace_id),
            "document_id": str(document.id),
            "user_id": str(editor.id),
            "revision": document.revision,
            "event": "document.updated",
        },
    )

    return document


def lock_document(document_id) -> Document:
    """
    Re-read a document with its row locked for the rest of the transaction.

    Every path that appends a version calls this first, which is what makes
    version numbering safe under concurrency — see `next_version_number`.

    Must be called inside a transaction; `select_for_update` raises otherwise,
    which is the correct failure rather than a silently unlocked read.
    """
    return Document.objects.select_for_update().get(pk=document_id)


def next_version_number(document: Document) -> int:
    """
    The next number in this document's history.

    Computed from the table rather than from a counter on the document, so it
    cannot drift out of step with the rows that actually exist.

    RACE CONDITION
    --------------
    `MAX(version_number) + 1` is read-then-write. Two concurrent saves would
    both read 5 and both try to insert 6, and one of them would die on the
    unique constraint — a 500 for a user who did nothing wrong.

    Two things prevent that, in order:

    1. Callers hold a `select_for_update` lock on the *document* row (see
       `lock_document`), so two writers to the same document serialise and the
       second one reads 6, not 5. Locking the document rather than the version
       table means writes to different documents still run in parallel.
    2. The unique constraint on (document, version_number) remains as the
       backstop. If a future code path forgets the lock, the database rejects
       the duplicate instead of silently producing two "version 6" rows.
    """
    current = document.versions.aggregate(highest=Max("version_number"))["highest"]
    return (current or 0) + 1


def append_version(
    *, document: Document, author, content: str, summary: str = ""
) -> DocumentVersion:
    """
    Add an immutable snapshot to a document's history.

    The caller is responsible for holding the document's row lock; every
    in-tree caller does. This function does not take it itself because the
    lock has to cover the caller's own read of the document too, not just this
    insert.
    """
    return DocumentVersion.objects.create(
        document=document,
        version_number=next_version_number(document),
        content=content,
        summary=summary[:200],
        created_by=author,
    )


@transaction.atomic
def restore_version(*, document: Document, version: DocumentVersion, actor) -> Document:
    """
    Restore a previous version by writing it forward.

    Restoring version 5 creates version 6 containing version 5's content. It
    never touches version 5, and it never removes versions 6..N — undoing a
    restore is just another restore. History only ever grows.

    `DocumentVersion.save()` refuses updates outright, so the wrong approach
    fails loudly rather than quietly rewriting the past. (README §9, §39)
    """
    if version.document_id != document.id:
        # Belongs to a different document. Guarded here as well as in the view
        # because a service must not depend on its callers being careful.
        raise VersionNotFoundError

    document = lock_document(document.pk)

    restored = append_version(
        document=document,
        author=actor,
        content=version.content,
        summary=f"Restored version {version.version_number}",
    )

    document.content = version.content
    document.excerpt = build_excerpt(version.content)
    document.revision += 1
    document.updated_by = actor
    document.save(
        update_fields=["content", "excerpt", "revision", "updated_by", "updated_at"]
    )

    # Recorded directly rather than through `_record_edit`, so a restore is
    # never collapsed into a neighbouring edit. Routine saves are noise worth
    # coalescing; deliberately rolling a document back is exactly the entry
    # someone will come looking for, and two restores are two facts.
    activity.record(
        workspace=document.workspace,
        actor=actor,
        action=ActivityAction.DOCUMENT_EDITED,
        entity_type=EntityType.DOCUMENT,
        entity_id=document.id,
        name=document.title,
        href=_document_href(document),
        context=f"Restored version {version.version_number}",
    )

    logger.info(
        "Document version restored",
        extra={
            "workspace_id": str(document.workspace_id),
            "document_id": str(document.id),
            "user_id": str(actor.id),
            "restored_from": version.version_number,
            "new_version": restored.version_number,
            "event": "document.version_restored",
        },
    )

    return document


# How long one person's continuous editing collapses into a single version when
# edits arrive over the WebSocket. Explicit REST saves always snapshot; socket
# autosave fires orders of magnitude more often, and a version per keystroke is
# not version history, it is a keylogger.
REALTIME_SNAPSHOT_WINDOW = timedelta(minutes=5)


def _should_snapshot(document: Document, editor) -> bool:
    """
    Whether a realtime edit deserves its own version.

    Yes when the previous version was somebody else's — so a handover is never
    lost inside another person's session — or when this person's last snapshot
    is older than the window.
    """
    latest = document.versions.order_by("-version_number").first()
    if latest is None:
        return True

    if latest.created_by_id != editor.id:
        return True

    return latest.created_at < timezone.now() - REALTIME_SNAPSHOT_WINDOW


@transaction.atomic
def apply_realtime_update(
    *, document: Document, editor, content: str, base_revision: int | None = None
) -> Document:
    """
    Apply an edit that arrived over the WebSocket.

    SERVER AUTHORITATIVE. The server's stored content is the single source of
    truth. A client sends the revision it based its edit on; if that no longer
    matches, the write is refused and the caller re-syncs the client from the
    server's copy. Last writer wins on an accepted write.

    This is deliberately **not** OT and **not** a CRDT. Two people typing in
    the same paragraph at the same instant will clobber one another — there is
    no transform and no merge. Claiming otherwise would be a lie about what
    this code does. (README §44, §82)

    Versions are coalesced rather than written per frame — see
    `_should_snapshot`. History still captures handovers and long sessions.
    """
    document = lock_document(document.pk)

    if base_revision is not None and base_revision != document.revision:
        raise StaleDocumentError

    if content == document.content:
        # A no-op save still confirms to the sender, but must not burn a
        # revision — that would invalidate every other client's base revision
        # for no reason.
        return document

    snapshot = _should_snapshot(document, editor)

    document.content = content
    document.excerpt = build_excerpt(content)
    document.revision += 1
    document.updated_by = editor
    document.save(
        update_fields=["content", "excerpt", "revision", "updated_by", "updated_at"]
    )

    if snapshot:
        append_version(
            document=document,
            author=editor,
            content=content,
            summary="Edited in the collaborative editor",
        )

    _record_edit(document=document, actor=editor)

    return document
