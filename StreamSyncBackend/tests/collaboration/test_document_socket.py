"""
The document collaboration WebSocket.

Driven through Channels' `WebsocketCommunicator`, which speaks ASGI directly to
the consumer — no server, no real network, but the same code path a browser
takes.

Two things make these tests unlike the REST ones:

- They are async, and each needs its own database access marked explicitly.
- Fixtures must be *committed* data, because the consumer reads through
  `database_sync_to_async` on another thread with its own connection. The
  usual transaction-wrapped fixtures are invisible from there, which is why
  these use `django_db(transaction=True)` and build their data inline.
"""

import uuid
from typing import Any

import pytest
import pytest_asyncio
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import AccessToken

from apps.collaboration import consumers
from apps.collaboration.auth import BEARER_SUBPROTOCOL
from apps.collaboration.consumers import CLOSE_FORBIDDEN, CLOSE_UNAUTHENTICATED
from apps.collaboration.events import ErrorCode, Inbound, Outbound
from config.asgi import application

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]

# AllowedHostsOriginValidator rejects a socket whose Origin is not in
# ALLOWED_HOSTS. Every connection here supplies one, exactly as a browser does.
ORIGIN_HEADER = (b"origin", b"http://localhost")


def socket_url(document_id) -> str:
    return f"/ws/documents/{document_id}/"


def connect_for(document_id, token: str | None) -> WebsocketCommunicator:
    """
    Build a communicator that authenticates the way the browser client does.

    The token rides in Sec-WebSocket-Protocol rather than a header or the query
    string — see apps/collaboration/auth.py for why.
    """
    subprotocols = [BEARER_SUBPROTOCOL, token] if token else []

    return WebsocketCommunicator(
        application,
        socket_url(document_id),
        headers=[ORIGIN_HEADER],
        subprotocols=subprotocols,
    )


@database_sync_to_async
def make_world(*, viewer_too: bool = False) -> dict:
    """
    Build a committed workspace, document and members.

    Written inline rather than reusing the shared fixtures because those live
    inside the test transaction, which the consumer's separate connection
    cannot see.
    """
    from django.contrib.auth import get_user_model

    from apps.documents import services as document_services
    from apps.workspaces import services as workspace_services
    from apps.workspaces.models import WorkspaceRole

    User = get_user_model()

    owner = User.objects.create_user(
        email="ws-owner@sockets.test", name="Owner", password=None
    )
    editor = User.objects.create_user(
        email="ws-editor@sockets.test", name="Editor", password=None
    )
    outsider = User.objects.create_user(
        email="ws-out@sockets.test", name="Outsider", password=None
    )

    workspace = workspace_services.create_workspace(owner=owner, name="Socket Team")

    workspace_services.invite_member(
        workspace=workspace,
        invited_by=owner,
        email=editor.email,
        role=WorkspaceRole.EDITOR,
    )
    workspace_services.accept_invitation(workspace=workspace, user=editor)

    viewer = None
    if viewer_too:
        viewer = User.objects.create_user(
            email="ws-viewer@sockets.test", name="Viewer", password=None
        )
        workspace_services.invite_member(
            workspace=workspace,
            invited_by=owner,
            email=viewer.email,
            role=WorkspaceRole.VIEWER,
        )
        workspace_services.accept_invitation(workspace=workspace, user=viewer)

    document = document_services.create_document(
        workspace=workspace,
        author=owner,
        title="Payment Requirements",
        content="<p>Original.</p>",
    )

    return {
        "owner": owner,
        "editor": editor,
        "viewer": viewer,
        "outsider": outsider,
        "workspace": workspace,
        "document": document,
        "owner_token": str(AccessToken.for_user(owner)),
        "editor_token": str(AccessToken.for_user(editor)),
        "viewer_token": str(AccessToken.for_user(viewer)) if viewer else None,
        "outsider_token": str(AccessToken.for_user(outsider)),
    }


@database_sync_to_async
def cleanup(world: dict) -> None:
    from django.contrib.auth import get_user_model

    from apps.activity.models import Activity
    from apps.documents.models import Document

    Activity.objects.filter(workspace=world["workspace"]).delete()
    Document.objects.filter(workspace=world["workspace"]).delete()
    world["workspace"].delete()
    get_user_model().objects.filter(email__endswith="@sockets.test").delete()


@pytest_asyncio.fixture
async def world():
    built = await make_world(viewer_too=True)
    yield built
    await cleanup(built)


async def drain(communicator: WebsocketCommunicator, count: int) -> list[dict]:
    """Read exactly `count` frames."""
    return [await communicator.receive_json_from(timeout=5) for _ in range(count)]


async def open_socket(world: dict, token_key: str = "owner_token"):
    """Connect and consume the two frames every successful join produces."""
    communicator = connect_for(world["document"].id, world[token_key])
    connected, _ = await communicator.connect(timeout=5)
    assert connected
    # document.sync then document.presence.
    await drain(communicator, 2)
    return communicator


class TestAuthentication:
    async def test_a_valid_token_connects(self, world: Any) -> None:
        communicator = connect_for(world["document"].id, world["owner_token"])

        connected, subprotocol = await communicator.connect(timeout=5)

        assert connected
        # The browser fails the handshake unless the server echoes the offered
        # subprotocol back.
        assert subprotocol == BEARER_SUBPROTOCOL

        await communicator.disconnect()

    async def test_no_token_is_rejected(self, world: Any) -> None:
        communicator = connect_for(world["document"].id, None)

        await communicator.connect(timeout=5)
        frame = await communicator.receive_json_from(timeout=5)

        assert frame["type"] == Outbound.ERROR
        assert frame["code"] == ErrorCode.UNAUTHENTICATED

        close = await communicator.receive_output(timeout=5)
        assert close["type"] == "websocket.close"
        assert close["code"] == CLOSE_UNAUTHENTICATED

        await communicator.disconnect()

    async def test_a_garbage_token_is_rejected(self, world: Any) -> None:
        communicator = connect_for(world["document"].id, "not-a-real-jwt")

        await communicator.connect(timeout=5)
        frame = await communicator.receive_json_from(timeout=5)

        assert frame["code"] == ErrorCode.UNAUTHENTICATED

        await communicator.disconnect()

    async def test_rejection_uses_a_no_retry_close_code(self, world: Any) -> None:
        """
        4001 tells the client not to reconnect.

        Closing *before* accepting would surface as 1006, indistinguishable
        from a network blip, and the client would retry a credential that will
        never work.
        """
        communicator = connect_for(world["document"].id, None)
        await communicator.connect(timeout=5)

        await communicator.receive_json_from(timeout=5)
        close = await communicator.receive_output(timeout=5)

        assert close["code"] in {4001, 4003, 1008}

        await communicator.disconnect()


class TestAuthorization:
    async def test_a_member_may_open_the_document(self, world: Any) -> None:
        communicator = connect_for(world["document"].id, world["editor_token"])

        connected, _ = await communicator.connect(timeout=5)

        assert connected
        await communicator.disconnect()

    async def test_a_non_member_is_rejected(self, world: Any) -> None:
        """Authorization happens before the room is joined. (README §15)"""
        communicator = connect_for(world["document"].id, world["outsider_token"])

        await communicator.connect(timeout=5)
        frame = await communicator.receive_json_from(timeout=5)

        assert frame["type"] == Outbound.ERROR
        assert frame["code"] == ErrorCode.FORBIDDEN

        close = await communicator.receive_output(timeout=5)
        assert close["code"] == CLOSE_FORBIDDEN

        await communicator.disconnect()

    async def test_an_unknown_document_is_rejected(self, world: Any) -> None:
        communicator = connect_for(uuid.uuid4(), world["owner_token"])

        await communicator.connect(timeout=5)
        frame = await communicator.receive_json_from(timeout=5)

        assert frame["code"] == ErrorCode.FORBIDDEN

        await communicator.disconnect()

    async def test_a_rejected_socket_receives_no_broadcasts(self, world: Any) -> None:
        """
        The outsider is closed before `group_add`, so nothing reaches them even
        while another member is actively editing.
        """
        member = await open_socket(world, "owner_token")

        intruder = connect_for(world["document"].id, world["outsider_token"])
        await intruder.connect(timeout=5)
        await intruder.receive_json_from(timeout=5)  # the error frame
        await intruder.receive_output(timeout=5)  # the close

        await member.send_json_to(
            {
                "type": Inbound.UPDATE,
                "documentId": str(world["document"].id),
                "content": "<p>Secret.</p>",
                "baseRevision": 1,
            }
        )
        await member.receive_json_from(timeout=5)  # the writer's `saved`

        assert await intruder.receive_nothing(timeout=0.5)

        await member.disconnect()
        await intruder.disconnect()


class TestJoinAndSync:
    async def test_joining_sends_sync_then_presence(self, world: Any) -> None:
        communicator = connect_for(world["document"].id, world["owner_token"])
        await communicator.connect(timeout=5)

        sync_frame, presence_frame = await drain(communicator, 2)

        assert sync_frame["type"] == Outbound.SYNC
        assert sync_frame["content"] == "<p>Original.</p>"
        assert sync_frame["revision"] == 1

        assert presence_frame["type"] == Outbound.PRESENCE
        assert len(presence_frame["participants"]) == 1

        await communicator.disconnect()

    async def test_the_roster_describes_the_participant(self, world: Any) -> None:
        communicator = connect_for(world["document"].id, world["owner_token"])
        await communicator.connect(timeout=5)
        _, presence_frame = await drain(communicator, 2)

        participant = presence_frame["participants"][0]

        assert participant["user"]["id"] == str(world["owner"].id)
        assert participant["user"]["name"] == "Owner"
        assert participant["state"] == "online"
        assert isinstance(participant["colorIndex"], int)
        # Cursors are relayed, never stored — see presence.py.
        assert participant["cursor"] is None
        assert participant["lastSeenAt"]

        await communicator.disconnect()

    async def test_a_second_member_is_announced_to_the_first(self, world: Any) -> None:
        first = await open_socket(world, "owner_token")

        second = connect_for(world["document"].id, world["editor_token"])
        await second.connect(timeout=5)

        announcement = await first.receive_json_from(timeout=5)

        assert announcement["type"] == Outbound.JOIN
        assert announcement["participant"]["user"]["id"] == str(world["editor"].id)

        await first.disconnect()
        await second.disconnect()

    async def test_the_second_member_sees_both_in_the_roster(self, world: Any) -> None:
        first = await open_socket(world, "owner_token")

        second = connect_for(world["document"].id, world["editor_token"])
        await second.connect(timeout=5)
        _, presence_frame = await drain(second, 2)

        ids = {p["user"]["id"] for p in presence_frame["participants"]}
        assert ids == {str(world["owner"].id), str(world["editor"].id)}

        await first.disconnect()
        await second.disconnect()

    async def test_an_explicit_join_frame_resyncs(self, world: Any) -> None:
        """What a reconnecting client sends to recover state."""
        communicator = await open_socket(world, "owner_token")

        await communicator.send_json_to(
            {"type": Inbound.JOIN, "documentId": str(world["document"].id)}
        )
        frames = await drain(communicator, 2)

        assert frames[0]["type"] == Outbound.SYNC
        assert frames[1]["type"] == Outbound.PRESENCE

        await communicator.disconnect()

    async def test_colour_is_stable_across_reconnects(self, world: Any) -> None:
        """Everyone must see the same person in the same colour. (§36)"""
        first = await open_socket(world, "owner_token")
        colour_a = None
        for _ in range(1):
            pass
        await first.send_json_to(
            {"type": Inbound.JOIN, "documentId": str(world["document"].id)}
        )
        _, presence_a = await drain(first, 2)
        colour_a = presence_a["participants"][0]["colorIndex"]
        await first.disconnect()

        second = await open_socket(world, "owner_token")
        await second.send_json_to(
            {"type": Inbound.JOIN, "documentId": str(world["document"].id)}
        )
        _, presence_b = await drain(second, 2)

        assert presence_b["participants"][0]["colorIndex"] == colour_a

        await second.disconnect()


class TestLeaveAndDisconnect:
    async def test_leaving_notifies_the_room(self, world: Any) -> None:
        first = await open_socket(world, "owner_token")

        second = connect_for(world["document"].id, world["editor_token"])
        await second.connect(timeout=5)
        await drain(second, 2)
        await first.receive_json_from(timeout=5)  # the join announcement

        await second.send_json_to(
            {"type": Inbound.LEAVE, "documentId": str(world["document"].id)}
        )

        frame = await first.receive_json_from(timeout=5)
        assert frame["type"] == Outbound.LEAVE
        assert frame["userId"] == str(world["editor"].id)

        await first.disconnect()
        await second.disconnect()

    async def test_disconnecting_notifies_the_room(self, world: Any) -> None:
        """A dropped socket must not leave a ghost in the roster."""
        first = await open_socket(world, "owner_token")

        second = connect_for(world["document"].id, world["editor_token"])
        await second.connect(timeout=5)
        await drain(second, 2)
        await first.receive_json_from(timeout=5)

        await second.disconnect()

        frame = await first.receive_json_from(timeout=5)
        assert frame["type"] == Outbound.LEAVE
        assert frame["userId"] == str(world["editor"].id)

        await first.disconnect()

    async def test_the_roster_shrinks_after_a_departure(self, world: Any) -> None:
        first = await open_socket(world, "owner_token")

        second = connect_for(world["document"].id, world["editor_token"])
        await second.connect(timeout=5)
        await drain(second, 2)
        await first.receive_json_from(timeout=5)
        await second.disconnect()
        await first.receive_json_from(timeout=5)  # the leave

        # A fresh join reports the roster as it now stands.
        await first.send_json_to(
            {"type": Inbound.JOIN, "documentId": str(world["document"].id)}
        )
        _, presence_frame = await drain(first, 2)

        ids = {p["user"]["id"] for p in presence_frame["participants"]}
        assert ids == {str(world["owner"].id)}

        await first.disconnect()


class TestDocumentUpdate:
    async def test_an_edit_is_persisted_and_confirmed(self, world: Any) -> None:
        communicator = await open_socket(world, "owner_token")

        await communicator.send_json_to(
            {
                "type": Inbound.UPDATE,
                "documentId": str(world["document"].id),
                "content": "<p>Edited over the socket.</p>",
                "baseRevision": 1,
            }
        )

        frame = await communicator.receive_json_from(timeout=5)

        assert frame["type"] == Outbound.SAVED
        assert frame["revision"] == 2
        assert frame["savedAt"]

        @database_sync_to_async
        def reload():
            from apps.documents.models import Document

            return Document.objects.get(pk=world["document"].pk)

        stored = await reload()
        assert stored.content == "<p>Edited over the socket.</p>"
        assert stored.revision == 2

        await communicator.disconnect()

    async def test_an_edit_reaches_other_participants(self, world: Any) -> None:
        first = await open_socket(world, "owner_token")

        second = connect_for(world["document"].id, world["editor_token"])
        await second.connect(timeout=5)
        await drain(second, 2)
        await first.receive_json_from(timeout=5)  # join announcement

        await first.send_json_to(
            {
                "type": Inbound.UPDATE,
                "documentId": str(world["document"].id),
                "content": "<p>Broadcast me.</p>",
                "baseRevision": 1,
            }
        )
        await first.receive_json_from(timeout=5)  # the writer's own `saved`

        frame = await second.receive_json_from(timeout=5)

        assert frame["type"] == Outbound.UPDATE
        assert frame["content"] == "<p>Broadcast me.</p>"
        assert frame["revision"] == 2
        assert frame["actorId"] == str(world["owner"].id)

        await first.disconnect()
        await second.disconnect()

    async def test_the_writer_does_not_receive_its_own_update(self, world: Any) -> None:
        """They already got `document.saved`; echoing would fight their cursor."""
        communicator = await open_socket(world, "owner_token")

        await communicator.send_json_to(
            {
                "type": Inbound.UPDATE,
                "documentId": str(world["document"].id),
                "content": "<p>Mine.</p>",
                "baseRevision": 1,
            }
        )

        frame = await communicator.receive_json_from(timeout=5)
        assert frame["type"] == Outbound.SAVED
        assert await communicator.receive_nothing(timeout=0.5)

        await communicator.disconnect()

    async def test_a_stale_edit_is_refused_and_resynced(self, world: Any) -> None:
        """
        Server authoritative: the client is handed the truth rather than an
        error, and rebases onto it.
        """
        communicator = await open_socket(world, "owner_token")

        await communicator.send_json_to(
            {
                "type": Inbound.UPDATE,
                "documentId": str(world["document"].id),
                "content": "<p>First.</p>",
                "baseRevision": 1,
            }
        )
        await communicator.receive_json_from(timeout=5)

        # Same base revision again — as a client that missed the update would.
        await communicator.send_json_to(
            {
                "type": Inbound.UPDATE,
                "documentId": str(world["document"].id),
                "content": "<p>Stale.</p>",
                "baseRevision": 1,
            }
        )

        frame = await communicator.receive_json_from(timeout=5)

        assert frame["type"] == Outbound.SYNC
        assert frame["content"] == "<p>First.</p>"
        assert frame["revision"] == 2

        await communicator.disconnect()

    async def test_a_viewer_cannot_edit(self, world: Any) -> None:
        """The role means the same thing here as it does over REST."""
        communicator = await open_socket(world, "viewer_token")

        await communicator.send_json_to(
            {
                "type": Inbound.UPDATE,
                "documentId": str(world["document"].id),
                "content": "<p>Vandalism.</p>",
                "baseRevision": 1,
            }
        )

        frame = await communicator.receive_json_from(timeout=5)

        assert frame["type"] == Outbound.ERROR
        assert frame["code"] == ErrorCode.READ_ONLY

        @database_sync_to_async
        def reload():
            from apps.documents.models import Document

            return Document.objects.get(pk=world["document"].pk)

        stored = await reload()
        assert stored.content == "<p>Original.</p>"

        await communicator.disconnect()

    async def test_a_frame_naming_another_document_is_refused(self, world: Any) -> None:
        """The socket is bound to one document; a frame cannot redirect it."""
        communicator = await open_socket(world, "owner_token")

        await communicator.send_json_to(
            {
                "type": Inbound.UPDATE,
                "documentId": str(uuid.uuid4()),
                "content": "<p>Elsewhere.</p>",
                "baseRevision": 1,
            }
        )

        frame = await communicator.receive_json_from(timeout=5)

        assert frame["type"] == Outbound.ERROR
        assert frame["code"] == ErrorCode.DOCUMENT_MISMATCH

        await communicator.disconnect()

    async def test_an_oversized_update_is_refused(self, world: Any) -> None:
        from apps.collaboration.events import MAX_CONTENT_LENGTH

        communicator = await open_socket(world, "owner_token")

        await communicator.send_json_to(
            {
                "type": Inbound.UPDATE,
                "documentId": str(world["document"].id),
                "content": "x" * (MAX_CONTENT_LENGTH + 1),
                "baseRevision": 1,
            }
        )

        frame = await communicator.receive_json_from(timeout=5)

        assert frame["code"] == ErrorCode.MALFORMED

        await communicator.disconnect()


class TestCursors:
    async def test_a_cursor_is_relayed_to_others(self, world: Any) -> None:
        first = await open_socket(world, "owner_token")

        second = connect_for(world["document"].id, world["editor_token"])
        await second.connect(timeout=5)
        await drain(second, 2)
        await first.receive_json_from(timeout=5)

        await second.send_json_to(
            {
                "type": Inbound.CURSOR,
                "documentId": str(world["document"].id),
                "cursor": {"anchor": 12, "head": 20},
            }
        )

        frame = await first.receive_json_from(timeout=5)

        assert frame["type"] == Outbound.CURSOR
        assert frame["userId"] == str(world["editor"].id)
        assert frame["cursor"] == {"anchor": 12, "head": 20}

        await first.disconnect()
        await second.disconnect()

    async def test_a_selection_uses_the_same_channel(self, world: Any) -> None:
        """A selection is a cursor whose anchor and head differ."""
        first = await open_socket(world, "owner_token")

        second = connect_for(world["document"].id, world["editor_token"])
        await second.connect(timeout=5)
        await drain(second, 2)
        await first.receive_json_from(timeout=5)

        await second.send_json_to(
            {
                "type": Inbound.SELECTION,
                "documentId": str(world["document"].id),
                "cursor": {"anchor": 0, "head": 40},
            }
        )

        frame = await first.receive_json_from(timeout=5)
        assert frame["type"] == Outbound.CURSOR
        assert frame["cursor"]["head"] == 40

        await first.disconnect()
        await second.disconnect()

    async def test_a_viewer_may_share_a_cursor(self, world: Any) -> None:
        """Read-only means cannot write the document, not cannot participate."""
        first = await open_socket(world, "owner_token")

        watcher = connect_for(world["document"].id, world["viewer_token"])
        await watcher.connect(timeout=5)
        await drain(watcher, 2)
        await first.receive_json_from(timeout=5)

        await watcher.send_json_to(
            {
                "type": Inbound.CURSOR,
                "documentId": str(world["document"].id),
                "cursor": {"anchor": 3, "head": 3},
            }
        )

        frame = await first.receive_json_from(timeout=5)
        assert frame["type"] == Outbound.CURSOR

        await first.disconnect()
        await watcher.disconnect()

    async def test_a_malformed_cursor_is_relayed_as_null(self, world: Any) -> None:
        """Cursors are cosmetic; a bad frame must not kill an editing session."""
        first = await open_socket(world, "owner_token")

        second = connect_for(world["document"].id, world["editor_token"])
        await second.connect(timeout=5)
        await drain(second, 2)
        await first.receive_json_from(timeout=5)

        await second.send_json_to(
            {
                "type": Inbound.CURSOR,
                "documentId": str(world["document"].id),
                "cursor": {"anchor": "not-a-number"},
            }
        )

        frame = await first.receive_json_from(timeout=5)
        assert frame["cursor"] is None

        await first.disconnect()
        await second.disconnect()

    async def test_cursors_are_never_written_to_the_database(self, world: Any) -> None:
        """
        The point of README §43. A caret moves as fast as someone types, and
        none of it belongs in PostgreSQL.
        """
        communicator = await open_socket(world, "owner_token")

        @database_sync_to_async
        def revision_and_versions():
            from apps.documents.models import Document, DocumentVersion

            document = Document.objects.get(pk=world["document"].pk)
            return document.revision, DocumentVersion.objects.filter(
                document=document
            ).count()

        before = await revision_and_versions()

        for offset in range(10):
            await communicator.send_json_to(
                {
                    "type": Inbound.CURSOR,
                    "documentId": str(world["document"].id),
                    "cursor": {"anchor": offset, "head": offset},
                }
            )

        assert await revision_and_versions() == before

        await communicator.disconnect()


class TestLiveness:
    async def test_ping_is_answered_with_pong(self, world: Any) -> None:
        """
        A half-open TCP connection looks alive until something writes to it.
        An application-level ping is the only thing that detects that.
        """
        communicator = await open_socket(world, "owner_token")

        await communicator.send_json_to({"type": Inbound.PING, "sentAt": 1234})

        frame = await communicator.receive_json_from(timeout=5)

        assert frame["type"] == Outbound.PONG
        assert frame["sentAt"] == 1234

        await communicator.disconnect()

    async def test_an_unknown_frame_is_ignored(self, world: Any) -> None:
        """An older client talking to a newer server keeps working."""
        communicator = await open_socket(world, "owner_token")

        await communicator.send_json_to(
            {"type": "document.telepathy", "documentId": str(world["document"].id)}
        )

        assert await communicator.receive_nothing(timeout=0.5)

        await communicator.disconnect()


@database_sync_to_async
def reload_document(document_id):
    from apps.documents.models import Document

    return Document.objects.get(pk=document_id)


@database_sync_to_async
def revoke_membership(world: dict, user) -> None:
    from apps.workspaces.models import WorkspaceMembership

    WorkspaceMembership.objects.filter(workspace=world["workspace"], user=user).delete()


@database_sync_to_async
def demote_to_viewer(world: dict, user) -> None:
    from apps.workspaces.models import WorkspaceMembership, WorkspaceRole

    WorkspaceMembership.objects.filter(workspace=world["workspace"], user=user).update(
        role=WorkspaceRole.VIEWER
    )


class TestRevocationMidSession:
    """
    Access is re-checked on a live socket, not only at connect.

    A socket outlives the decision that opened it — an editor left open for an
    afternoon holds one for hours. Without a re-check, removing somebody from a
    workspace would take effect over REST immediately and over the socket not
    at all, and the two must not disagree about who may write.

    `REAUTHORIZE_AFTER_SECONDS` is patched to zero so the check runs on the
    next frame instead of a minute later; production trades a bounded window
    for not putting a query in front of every keystroke.
    """

    async def test_a_removed_member_is_closed_out(
        self, world: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(consumers, "REAUTHORIZE_AFTER_SECONDS", 0)
        communicator = await open_socket(world, "editor_token")

        await revoke_membership(world, world["editor"])

        await communicator.send_json_to(
            {
                "type": Inbound.UPDATE,
                "documentId": str(world["document"].id),
                "content": "<p>Written after removal.</p>",
                "baseRevision": 1,
            }
        )

        frame = await communicator.receive_json_from(timeout=5)
        assert frame["type"] == Outbound.ERROR
        assert frame["code"] == ErrorCode.FORBIDDEN

        close = await communicator.receive_output(timeout=5)
        assert close["type"] == "websocket.close"
        assert close["code"] == CLOSE_FORBIDDEN

        # And the write never landed.
        document = await reload_document(world["document"].id)
        assert document.content == "<p>Original.</p>"

        await communicator.disconnect()

    async def test_a_demoted_editor_becomes_read_only(
        self, world: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """
        Demotion is not disconnection.

        A viewer is still allowed in the room — presence and live updates are
        the point — so the socket stays open and only the write is refused.
        """
        monkeypatch.setattr(consumers, "REAUTHORIZE_AFTER_SECONDS", 0)
        communicator = await open_socket(world, "editor_token")

        await demote_to_viewer(world, world["editor"])

        await communicator.send_json_to(
            {
                "type": Inbound.UPDATE,
                "documentId": str(world["document"].id),
                "content": "<p>Written after demotion.</p>",
                "baseRevision": 1,
            }
        )

        frame = await communicator.receive_json_from(timeout=5)
        assert frame["type"] == Outbound.ERROR
        assert frame["code"] == ErrorCode.READ_ONLY

        document = await reload_document(world["document"].id)
        assert document.content == "<p>Original.</p>"

        await communicator.disconnect()
