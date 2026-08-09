"""
WebSocket authentication and document authorization.

Identity comes from the connection, never from a frame. A client that could
name its own user id could impersonate anybody in the room. (README §16, §41)
"""

import logging

from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from apps.documents.models import Document
from apps.workspaces.models import WorkspaceRole
from apps.workspaces.selectors import scoped_to_user_workspaces
from common.permissions import has_workspace_role

logger = logging.getLogger("streamsync.collaboration")

User = get_user_model()

# The client offers ["streamsync.bearer", "<access token>"] in
# Sec-WebSocket-Protocol. A browser cannot set an Authorization header on a
# WebSocket, and the alternative — a token in the query string — ends up in
# access logs, browser history and Referer headers, which is where credentials
# go to leak.
#
# The server MUST echo this value back in accept(), or the browser fails the
# handshake. (StreamSyncFrontend/src/websocket/client.ts)
BEARER_SUBPROTOCOL = "streamsync.bearer"


def extract_token(scope: dict) -> str | None:
    """Pull the access token out of the offered subprotocols."""
    subprotocols = scope.get("subprotocols") or []

    try:
        marker = subprotocols.index(BEARER_SUBPROTOCOL)
    except ValueError:
        return None

    # The token is the value immediately after the marker.
    if marker + 1 >= len(subprotocols):
        return None

    token = subprotocols[marker + 1].strip()
    return token or None


@database_sync_to_async
def authenticate(token: str | None):
    """
    Resolve an access token to a user, or None.

    The user is re-read from the database rather than trusted from the token's
    claims, so an account deactivated moments ago cannot open a socket for the
    rest of the token's lifetime. Sockets are long-lived, which makes that
    window matter more here than it does on a request.
    """
    if not token:
        return None

    try:
        access = AccessToken(token)
    except TokenError:
        # Expired, malformed, wrong signature — all "sign in again" to the
        # client, and the specific reason is not something an unauthenticated
        # caller should learn.
        return None

    user_id = access.payload.get("user_id")
    if user_id is None:
        return None

    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return None

    return user if user.is_active else None


@database_sync_to_async
def authorize_document(user, document_id):
    """
    The document, if this user may open it. None otherwise.

    Routed through `scoped_to_user_workspaces` — the same chokepoint every REST
    endpoint uses — so socket access and HTTP access can never drift apart.
    A document in another tenant is not found rather than forbidden.
    """
    return (
        scoped_to_user_workspaces(Document.objects.all(), user)
        .select_related("workspace")
        .filter(pk=document_id)
        .first()
    )


@database_sync_to_async
def can_edit(user, document) -> bool:
    """
    Whether this user may write to the document over the socket.

    Viewers connect and watch — presence, cursors and live updates all work —
    but their edits are refused. The role means the same thing here as it does
    over REST. (README §20)
    """
    return has_workspace_role(user, document.workspace, WorkspaceRole.EDITOR)
