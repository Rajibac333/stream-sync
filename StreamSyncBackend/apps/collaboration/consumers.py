"""
The document collaboration socket.

    ws://host/ws/documents/<document_id>/

One socket, one document. The document is fixed by the URL at connect time and
never changes, which removes a whole class of confusion: no frame can move a
connection to a document its owner never proved access to. (README §15, §16)

SYNCHRONISATION MODEL: SERVER AUTHORITATIVE

The server's stored content is the single source of truth. A client sends the
revision it based its edit on; a mismatch is refused and the client is re-synced
from the server's copy. An accepted write is last-writer-wins.

This is **not** operational transformation and **not** a CRDT. Two people
typing in the same paragraph at the same instant will clobber one another.
The architecture leaves room for a real merge algorithm later — every edit
already flows through one service function with a revision check — but nothing
here merges anything, and saying otherwise would misrepresent the code.
(README §44, §82)
"""

import logging
import time

from asgiref.sync import sync_to_async
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone

from apps.documents.models import Document
from apps.documents.services import StaleDocumentError, apply_realtime_update

from . import events, presence
from .auth import (
    BEARER_SUBPROTOCOL,
    authenticate,
    authorize_document,
    can_edit,
    extract_token,
)
from .events import ErrorCode, Inbound

logger = logging.getLogger("streamsync.collaboration")

# Close codes. The frontend treats 4001, 4003 and 1008 as "do not retry" — a
# client that reconnects with a rejected credential just burns its backoff
# schedule against a server that will keep saying no.
# (StreamSyncFrontend/src/websocket/client.ts)
CLOSE_UNAUTHENTICATED = 4001
CLOSE_FORBIDDEN = 4003

# How long an authorization decision made at connect time stays good.
#
# A socket is long-lived — hours, in an editor left open — and access is not.
# Removing someone from a workspace, or demoting them to viewer, has to take
# effect on the socket they already hold, not only on the next one they open.
# Re-checking on every frame would put a query in front of every keystroke, so
# writes re-verify at most this often. A revoked user therefore keeps write
# access for at most this long, which is a deliberate, bounded trade.
REAUTHORIZE_AFTER_SECONDS = 60


def group_name(document_id) -> str:
    """
    The channel-layer group for one document's room.

    Group names must be ASCII and under 100 characters; a UUID satisfies both.
    """
    return f"document.{document_id}"


class DocumentConsumer(AsyncJsonWebsocketConsumer):
    """Serves one client's connection to one document."""

    async def connect(self) -> None:
        self.document = None
        self.user = None
        self.group = None
        self.editable = False

        document_id = self.scope["url_route"]["kwargs"]["document_id"]

        # 1. Authenticate. Identity comes from the token on the connection,
        #    never from anything the client sends later.
        user = await authenticate(self._offered_token())
        if user is None:
            await self._reject(
                CLOSE_UNAUTHENTICATED,
                "Authentication required.",
                ErrorCode.UNAUTHENTICATED,
                document_id,
            )
            return

        # 2. Authorize *before* joining the room, so an unauthorised socket
        #    never receives a single broadcast. (README §15)
        document = await authorize_document(user, document_id)
        if document is None:
            await self._reject(
                CLOSE_FORBIDDEN,
                "You do not have access to this document.",
                ErrorCode.FORBIDDEN,
                document_id,
            )
            return

        self.user = user
        self.document = document
        self.editable = await can_edit(user, document)
        self._authorized_at = time.monotonic()
        self.group = group_name(document.id)

        await self.channel_layer.group_add(self.group, self.channel_name)

        # The browser fails the handshake unless the server echoes one of the
        # offered subprotocols back. See auth.BEARER_SUBPROTOCOL.
        await self.accept(subprotocol=self._accepted_subprotocol())

        await self._on_joined()

        logger.info(
            "Document socket connected",
            extra={
                "document_id": str(document.id),
                "workspace_id": str(document.workspace_id),
                "user_id": str(user.id),
                "editable": self.editable,
                "event": "collaboration.connected",
            },
        )

    async def disconnect(self, code: int) -> None:
        """
        Leave the room and tell everyone.

        Runs on a clean close and on a dropped connection alike. If the worker
        dies without reaching this, the roster's TTL cleans up instead.
        """
        if self.group is None or self.user is None:
            return

        await self._depart()
        await self.channel_layer.group_discard(self.group, self.channel_name)

        logger.info(
            "Document socket disconnected",
            extra={
                "document_id": str(self.document.id),
                "user_id": str(self.user.id),
                "close_code": code,
                "event": "collaboration.disconnected",
            },
        )

    # -- inbound ----------------------------------------------------------

    async def receive_json(self, content: dict, **kwargs) -> None:
        """Route one client frame."""
        if not isinstance(content, dict):
            return

        message_type = content.get("type")

        if message_type == Inbound.PING:
            # Liveness only; no document involved.
            await self.send_json(events.pong(content.get("sentAt")))
            return

        if self.document is None:
            return

        # A frame naming a different document than the socket is bound to is
        # either a client bug or an attempt to write somewhere else. Neither is
        # honoured, and the document is never selected from the frame.
        # (README §16)
        stated = content.get("documentId")
        if stated is not None and str(stated) != str(self.document.id):
            await self.send_json(
                events.error(
                    document_id=self.document.id,
                    message="That frame names a different document.",
                    code=ErrorCode.DOCUMENT_MISMATCH,
                )
            )
            return

        handlers = {
            Inbound.JOIN: self._handle_join,
            Inbound.LEAVE: self._handle_leave,
            Inbound.UPDATE: self._handle_update,
            Inbound.CURSOR: self._handle_cursor,
            Inbound.SELECTION: self._handle_cursor,
        }

        handler = handlers.get(message_type)
        if handler is None:
            # Unrecognised frames are ignored rather than fatal, so an older
            # client talking to a newer server keeps working.
            return

        await handler(content)

    async def _handle_join(self, content: dict) -> None:
        """
        Re-announce presence and re-sync.

        Joining is implicit at connect, so this exists for reconnects: the
        client re-sends `document.join` after the socket comes back and gets a
        fresh sync plus roster, which is what makes reconnection recover state
        rather than merely restore a pipe.
        """
        if not await self._still_authorized():
            return

        await self._on_joined()

    async def _handle_leave(self, content: dict) -> None:
        """
        Leave the room without closing the socket.

        The client sends this when the editor unmounts but the connection is
        still being reused.
        """
        await self._depart()

    async def _handle_update(self, content: dict) -> None:
        # Access is re-checked before a write, at most once a minute. Anyone
        # whose membership was revoked mid-session is closed out here rather
        # than continuing to write until they happen to reconnect.
        if not await self._still_authorized():
            return

        if not self.editable:
            # Viewers watch. Their edits are refused, exactly as over REST.
            await self.send_json(
                events.error(
                    document_id=self.document.id,
                    message="Your role in this workspace does not allow changes.",
                    code=ErrorCode.READ_ONLY,
                )
            )
            return

        body = content.get("content")
        if not isinstance(body, str) or len(body) > events.MAX_CONTENT_LENGTH:
            await self.send_json(
                events.error(
                    document_id=self.document.id,
                    message="The update frame was malformed or too large.",
                    code=ErrorCode.MALFORMED,
                )
            )
            return

        base_revision = content.get("baseRevision")
        if isinstance(base_revision, bool) or not isinstance(base_revision, int):
            base_revision = None

        try:
            document = await self._apply_update(body, base_revision)
        except StaleDocumentError:
            # Server authoritative: rather than erroring, hand the client the
            # truth and let it rebase. This is the whole conflict story.
            await self._send_sync()
            return

        self.document = document

        # Mark the writer as actively editing, which is what drives the
        # "Maria is editing…" indicator. (README §35)
        await self._roster_touch(presence.PresenceState.EDITING)

        await self._broadcast(
            {
                "type": "fanout.update",
                "content": document.content,
                "revision": document.revision,
                "actor_id": str(self.user.id),
            }
        )

        await self.send_json(
            events.saved(
                document_id=document.id,
                revision=document.revision,
                saved_at=timezone.now().isoformat(),
            )
        )

    async def _handle_cursor(self, content: dict) -> None:
        """
        Relay a caret position.

        Straight through the channel layer to the room and stored nowhere —
        see presence.py. Both `document.cursor` and `document.selection` land
        here because a selection is a cursor whose anchor and head differ.
        """
        position = events.parse_cursor(content.get("cursor"))

        await self._broadcast(
            {
                "type": "fanout.cursor",
                "user_id": str(self.user.id),
                "cursor": position,
            }
        )

    # -- channel layer fan-out -------------------------------------------

    async def fanout_update(self, message: dict) -> None:
        """Another client's edit. The originator already got `document.saved`."""
        if message["actor_id"] == str(self.user.id):
            return

        await self.send_json(
            events.update(
                document_id=self.document.id,
                content=message["content"],
                revision=message["revision"],
                actor_id=message["actor_id"],
            )
        )

    async def fanout_cursor(self, message: dict) -> None:
        if message["user_id"] == str(self.user.id):
            return

        await self.send_json(
            events.cursor(
                document_id=self.document.id,
                user_id=message["user_id"],
                position=message["cursor"],
            )
        )

    async def fanout_join(self, message: dict) -> None:
        if message["user_id"] == str(self.user.id):
            return

        await self.send_json(
            events.joined(
                document_id=self.document.id, participant=message["participant"]
            )
        )

    async def fanout_leave(self, message: dict) -> None:
        if message["user_id"] == str(self.user.id):
            return

        await self.send_json(
            events.left(document_id=self.document.id, user_id=message["user_id"])
        )

    # -- helpers ----------------------------------------------------------

    async def _still_authorized(self) -> bool:
        """
        Re-verify access, at most once per `REAUTHORIZE_AFTER_SECONDS`.

        Returns False and closes the socket when access is gone. Membership is
        re-read through the same `scoped_to_user_workspaces` chokepoint the
        connect path uses, so revocation cannot be honoured by REST and missed
        by the socket. The role is refreshed at the same time, which is what
        makes a demotion to viewer take effect without a reconnect.
        """
        elapsed = time.monotonic() - self._authorized_at
        if elapsed < REAUTHORIZE_AFTER_SECONDS:
            return True

        document = await authorize_document(self.user, self.document.id)
        if document is None:
            logger.info(
                "Document socket closed after access was revoked",
                extra={
                    "document_id": str(self.document.id),
                    "user_id": str(self.user.id),
                    "event": "collaboration.access_revoked",
                },
            )
            await self.send_json(
                events.error(
                    document_id=self.document.id,
                    message="You no longer have access to this document.",
                    code=ErrorCode.FORBIDDEN,
                )
            )
            await self.close(code=CLOSE_FORBIDDEN)
            return False

        self.editable = await can_edit(self.user, document)
        self._authorized_at = time.monotonic()
        return True

    def _offered_token(self) -> str | None:
        return extract_token(self.scope)

    def _accepted_subprotocol(self) -> str | None:
        offered = self.scope.get("subprotocols") or []
        return BEARER_SUBPROTOCOL if BEARER_SUBPROTOCOL in offered else None

    async def _reject(
        self, code: int, message: str, error_code: str, document_id
    ) -> None:
        """
        Refuse a connection with a close code the client can act on.

        The handshake is accepted first and closed immediately after. Closing
        *before* accepting makes the server reject the handshake outright, and
        the browser then reports close code 1006 — indistinguishable from a
        network blip, so the client would retry a credential that will never
        work. Accepting costs one round trip and buys a truthful reason.
        """
        await self.accept(subprotocol=self._accepted_subprotocol())
        await self.send_json(
            events.error(document_id=document_id, message=message, code=error_code)
        )
        await self.close(code=code)

        logger.info(
            "Document socket rejected",
            extra={
                "document_id": str(document_id),
                "close_code": code,
                "reason": error_code,
                "event": "collaboration.rejected",
            },
        )

    async def _on_joined(self) -> None:
        """Seed this client, then tell the room."""
        participant = presence.build_participant(
            user=self.user,
            document_id=self.document.id,
            state=presence.PresenceState.ONLINE,
        )

        roster = await self._roster_join(participant)

        await self._send_sync()
        await self.send_json(
            events.presence(document_id=self.document.id, participants=roster)
        )
        await self._broadcast(
            {
                "type": "fanout.join",
                "user_id": str(self.user.id),
                "participant": participant,
            }
        )

    async def _depart(self) -> None:
        await self._roster_leave()
        await self._broadcast({"type": "fanout.leave", "user_id": str(self.user.id)})

    async def _send_sync(self) -> None:
        document = await self._reload_document()
        self.document = document
        await self.send_json(
            events.sync(
                document_id=document.id,
                content=document.content,
                revision=document.revision,
            )
        )

    async def _broadcast(self, message: dict) -> None:
        await self.channel_layer.group_send(self.group, message)

    # -- blocking work, moved off the event loop --------------------------
    #
    # The consumer runs in an async context. Every database and cache call
    # below is synchronous, and calling one directly would block the whole
    # worker's event loop — stalling every other socket it serves, not just
    # this one.

    @database_sync_to_async
    def _apply_update(self, content: str, base_revision: int | None):
        return apply_realtime_update(
            document=self.document,
            editor=self.user,
            content=content,
            base_revision=base_revision,
        )

    @database_sync_to_async
    def _reload_document(self):
        """
        Re-read the authoritative state.

        Always from the database rather than from `self.document`, which is a
        snapshot from connect time and goes stale the moment anyone else
        writes.
        """
        return Document.objects.get(pk=self.document.pk)

    @sync_to_async
    def _roster_join(self, participant: dict) -> list[dict]:
        return presence.join(document_id=self.document.id, participant=participant)

    @sync_to_async
    def _roster_leave(self) -> None:
        presence.leave(document_id=self.document.id, user_id=self.user.id)

    @sync_to_async
    def _roster_touch(self, state: str) -> None:
        presence.touch(document_id=self.document.id, user_id=self.user.id, state=state)
