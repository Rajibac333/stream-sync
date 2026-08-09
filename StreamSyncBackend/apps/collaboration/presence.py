"""
Who is in a document right now.

Presence is temporary state and is never written to PostgreSQL. It lives in the
cache — Redis in any real deployment — with a TTL, so a worker that dies
without running `disconnect` leaves a roster that expires by itself rather than
a ghost that stays forever. (README §42, §43)

CURSORS ARE NOT STORED AT ALL

Cursor frames arrive as fast as a person can move a caret. They are relayed
through the channel layer straight to the room and never written anywhere —
not to PostgreSQL, and not to Redis either. Storing them would mean a write per
keystroke for data that is worthless a moment later. (README §43)

The visible consequence is that someone joining an active document sees no
cursors until each person next moves. That is a fair trade for not running a
write-per-keystroke workload, and the gap closes within a keystroke.
"""

import hashlib
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from django.core.cache import cache

# Long enough to survive a slow reconnect, short enough that an abandoned entry
# disappears while the document is still open. Refreshed on every roster write.
ROSTER_TTL_SECONDS = 120

# How many distinct collaborator colours the client has. The server assigns the
# index so everyone sees the same person in the same colour; deriving it
# client-side from join order gives every client a different mapping.
# (StreamSyncFrontend/src/websocket/types.ts)
COLOR_COUNT = 8


class PresenceState:
    """Matches the frontend's `PresenceState` union."""

    ONLINE = "online"
    IDLE = "idle"
    EDITING = "editing"
    OFFLINE = "offline"


def roster_key(document_id: UUID | str) -> str:
    return f"presence:document:{document_id}"


def color_index(user_id: UUID | str) -> int:
    """
    A stable colour for a user, derived rather than allocated.

    A hash needs no coordination and no storage, and gives the same answer on
    every worker — which is what "everyone sees Maria in the same colour"
    requires. Allocating from a shared counter would need a lock and would
    still drift once someone leaves and rejoins.

    md5 is used as a hash function here, not as a security primitive.
    """
    digest = hashlib.md5(str(user_id).encode(), usedforsecurity=False).digest()
    return digest[0] % COLOR_COUNT


def build_participant(*, user, document_id: UUID | str, state: str) -> dict:
    """
    One entry in the roster, in the shape the client expects.

    `cursor` is always null here — see the module docstring. The client fills
    it in from `document.cursor` frames as people move.
    """
    return {
        "user": {
            "id": str(user.id),
            "name": user.name,
            "avatarUrl": user.avatar_url or None,
        },
        "state": state,
        "colorIndex": color_index(user.id),
        "documentId": str(document_id),
        "cursor": None,
        "lastSeenAt": datetime.now(tz=UTC).isoformat(),
    }


def _read(document_id: UUID | str) -> dict[str, Any]:
    return cache.get(roster_key(document_id)) or {}


def _write(document_id: UUID | str, roster: dict[str, Any]) -> None:
    cache.set(roster_key(document_id), roster, timeout=ROSTER_TTL_SECONDS)


def join(*, document_id: UUID | str, participant: dict) -> list[dict]:
    """
    Add someone to the roster and return the whole thing.

    Read-modify-write, which two simultaneous joins can race: the later write
    can drop the earlier participant. The consequence is a transiently missing
    face in one client's roster, which the next presence write repairs, and the
    TTL bounds even that. Presence is soft state by definition (README §42), so
    a lock and its contention would cost more than the defect.
    """
    roster = _read(document_id)
    roster[participant["user"]["id"]] = participant
    _write(document_id, roster)
    return list(roster.values())


def touch(*, document_id: UUID | str, user_id: UUID | str, state: str) -> dict | None:
    """Update someone's state and last-seen. Returns the updated participant."""
    roster = _read(document_id)
    participant = roster.get(str(user_id))
    if participant is None:
        return None

    participant["state"] = state
    participant["lastSeenAt"] = datetime.now(tz=UTC).isoformat()
    roster[str(user_id)] = participant
    _write(document_id, roster)
    return participant


def leave(*, document_id: UUID | str, user_id: UUID | str) -> list[dict]:
    """Remove someone and return the remaining roster."""
    roster = _read(document_id)
    roster.pop(str(user_id), None)

    if roster:
        _write(document_id, roster)
    else:
        # Nobody left: drop the key rather than leaving an empty dict to expire.
        cache.delete(roster_key(document_id))

    return list(roster.values())


def participants(document_id: UUID | str) -> list[dict]:
    return list(_read(document_id).values())
