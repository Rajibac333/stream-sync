"""
The WebSocket wire protocol.

Every frame that crosses the socket is built or parsed here, so the format is
defined in exactly one place. (README §55, §81)

WIRE FORMAT

Frames are flat JSON objects with a `type` discriminator and **camelCase**
keys:

    {"type": "document.update", "documentId": "…", "content": "…", "revision": 7}

This differs from the REST API, which is snake_case, and from the illustrative
example in README §41, which wraps a payload. It matches the contract the
frontend's socket layer is already built against
(StreamSyncFrontend/src/websocket/types.ts), which validates frames rather than
casting them and has no mapping layer to adapt a different shape. §41 asks for
*predictable* events; these are predictable, just in the client's dialect. The
deviation is deliberate and documented in SETUP.md.

TRUST

Inbound frames carry a `documentId`. It is never used to select a document —
the socket is bound to one document by its URL, and a frame naming a different
one is rejected. Likewise no inbound frame carries a user identity; the actor
is always taken from the authenticated connection. (README §16, §41)
"""

from typing import Any
from uuid import UUID

# ---------------------------------------------------------------------------
# Event names
# ---------------------------------------------------------------------------


class Inbound:
    """Frames the client may send."""

    PING = "system.ping"
    JOIN = "document.join"
    LEAVE = "document.leave"
    UPDATE = "document.update"
    CURSOR = "document.cursor"
    SELECTION = "document.selection"


class Outbound:
    """Frames the server sends."""

    PONG = "system.pong"
    JOIN = "document.join"
    LEAVE = "document.leave"
    SYNC = "document.sync"
    UPDATE = "document.update"
    PRESENCE = "document.presence"
    CURSOR = "document.cursor"
    SAVED = "document.saved"
    ERROR = "document.error"


class ErrorCode:
    """Machine-readable reasons on a `document.error` frame."""

    UNAUTHENTICATED = "UNAUTHENTICATED"
    FORBIDDEN = "FORBIDDEN"
    READ_ONLY = "READ_ONLY"
    DOCUMENT_MISMATCH = "DOCUMENT_MISMATCH"
    MALFORMED = "MALFORMED"
    INTERNAL = "INTERNAL"


# Cursor offsets are bounded so a malformed or hostile frame cannot store an
# absurd integer in the roster or overflow a client's rendering.
MAX_CURSOR_OFFSET = 10_000_000

# A single update frame. Larger bodies belong on the REST endpoint, where the
# request size limit applies; without a cap here one socket could push
# unbounded memory through the channel layer.
MAX_CONTENT_LENGTH = 1_000_000


# ---------------------------------------------------------------------------
# Outbound frame builders
# ---------------------------------------------------------------------------


def pong(sent_at: Any) -> dict:
    """Echo the client's timestamp so it can measure round-trip latency."""
    return {"type": Outbound.PONG, "sentAt": sent_at}


def sync(*, document_id: UUID, content: str, revision: int) -> dict:
    """The authoritative document state. Sent on join and after a conflict."""
    return {
        "type": Outbound.SYNC,
        "documentId": str(document_id),
        "content": content,
        "revision": revision,
    }


def update(*, document_id: UUID, content: str, revision: int, actor_id: UUID) -> dict:
    return {
        "type": Outbound.UPDATE,
        "documentId": str(document_id),
        "content": content,
        "revision": revision,
        "actorId": str(actor_id),
    }


def saved(*, document_id: UUID, revision: int, saved_at: str) -> dict:
    """Confirms the writer's own edit landed. Drives the "Saved" indicator."""
    return {
        "type": Outbound.SAVED,
        "documentId": str(document_id),
        "revision": revision,
        "savedAt": saved_at,
    }


def joined(*, document_id: UUID, participant: dict) -> dict:
    """Additive — the client merges this into its roster, no full replacement."""
    return {
        "type": Outbound.JOIN,
        "documentId": str(document_id),
        "participant": participant,
    }


def left(*, document_id: UUID, user_id: UUID) -> dict:
    return {
        "type": Outbound.LEAVE,
        "documentId": str(document_id),
        "userId": str(user_id),
    }


def presence(*, document_id: UUID, participants: list[dict]) -> dict:
    """The full roster. Sent once on join to seed the client's view."""
    return {
        "type": Outbound.PRESENCE,
        "documentId": str(document_id),
        "participants": participants,
    }


def cursor(*, document_id: UUID, user_id: UUID, position: dict | None) -> dict:
    return {
        "type": Outbound.CURSOR,
        "documentId": str(document_id),
        "userId": str(user_id),
        "cursor": position,
    }


def error(*, document_id: UUID | str, message: str, code: str) -> dict:
    return {
        "type": Outbound.ERROR,
        "documentId": str(document_id),
        "message": message,
        "code": code,
    }


# ---------------------------------------------------------------------------
# Inbound parsing
# ---------------------------------------------------------------------------


def parse_cursor(raw: Any) -> dict | None:
    """
    Validate a cursor payload.

    Returns None for anything malformed rather than raising: a bad cursor frame
    is not worth tearing a working editing session down for, and cursors are
    cosmetic. Offsets are clamped to a sane range — see MAX_CURSOR_OFFSET.
    """
    if not isinstance(raw, dict):
        return None

    anchor = raw.get("anchor")
    head = raw.get("head", anchor)

    # bool is a subclass of int; True would otherwise become offset 1.
    if not isinstance(anchor, int) or isinstance(anchor, bool):
        return None
    if not isinstance(head, int) or isinstance(head, bool):
        return None
    if not (0 <= anchor <= MAX_CURSOR_OFFSET and 0 <= head <= MAX_CURSOR_OFFSET):
        return None

    return {"anchor": anchor, "head": head}
