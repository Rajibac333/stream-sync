# StreamSync WebSocket Protocol

Version 1.0 — Milestone 7.

The real-time protocol for collaborative document editing. This document is the
contract; `apps/collaboration/` implements it and
`StreamSyncFrontend/src/websocket/` consumes it.

---

## Endpoint

```
ws://localhost:8000/ws/documents/<document_id>/      development
wss://api.streamsync.app/ws/documents/<document_id>/ production
```

**One socket, one document.** The document is fixed by the URL at connect time
and never changes. A frame cannot move a connection to a different document —
see [Trust model](#trust-model).

---

## Handshake

### Authentication

The token travels in `Sec-WebSocket-Protocol`:

```
Sec-WebSocket-Protocol: streamsync.bearer, <access token>
```

A browser cannot set an `Authorization` header on a WebSocket. The alternative
— `?token=…` — puts a credential in access logs, browser history and `Referer`
headers, which is where credentials go to leak.

**The server echoes `streamsync.bearer` back in its accept.** A browser fails
the handshake if the server does not select one of the offered subprotocols.

The token is the same short-lived JWT access token the REST API uses. The user
is re-read from the database on connect, so a deactivated account cannot open a
socket even with an unexpired token.

### Authorization

Access is checked **before** the connection joins the document room, so a
rejected socket never receives a single broadcast. It uses the same
`scoped_to_user_workspaces` chokepoint as every REST endpoint, so socket access
and HTTP access cannot drift apart.

### Rejection

A rejected connection is **accepted and then immediately closed** with a
meaningful code. Closing before accepting makes the server reject the handshake
outright, and the browser reports `1006` — indistinguishable from a network
blip, so a client would retry a credential that will never work.

| Code | Meaning | Client should |
| --- | --- | --- |
| `4001` | No, invalid or expired token | Re-authenticate. **Do not retry.** |
| `4003` | Authenticated, but no access to this document | Give up. **Do not retry.** |
| `1000` | Normal closure | Nothing |
| other | Network or server fault | Reconnect with backoff |

A `document.error` frame carrying a machine-readable `code` is sent
immediately before the close, so the client has a reason to log or display.

---

## Frame format

Flat JSON objects with a `type` discriminator and **camelCase** keys:

```json
{ "type": "document.update", "documentId": "…", "content": "…", "revision": 7 }
```

> **Note on conventions.** The REST API is snake_case; this protocol is
> camelCase, and it does not wrap payloads the way the illustrative example in
> `README.md` §41 does. It matches the contract the frontend socket layer is
> already built against, which validates frames rather than casting them and
> has no mapping layer. §41 asks for *predictable* events; these are
> predictable, in the client's dialect. The deviation is deliberate.

---

## Client → server

| Type | Fields | Notes |
| --- | --- | --- |
| `system.ping` | `sentAt` | Liveness. Answered with `system.pong`. |
| `document.join` | `documentId` | Re-sync. Implicit at connect; sent again after a reconnect. |
| `document.leave` | `documentId` | Leave the roster without closing the socket. |
| `document.update` | `documentId`, `content`, `baseRevision` | Editor role required. |
| `document.cursor` | `documentId`, `cursor` | Relayed, never stored. |
| `document.selection` | `documentId`, `cursor` | Same channel as `document.cursor`. |

`cursor` is `{ "anchor": <int>, "head": <int> }` in document character offsets.
`anchor == head` means a caret with no selection. Malformed values are relayed
as `null` rather than dropping the connection — cursors are cosmetic.

Unrecognised frame types are **ignored**, so an older client talking to a newer
server keeps working.

### Limits

| Limit | Value | Why |
| --- | --- | --- |
| `content` length | 1,000,000 chars | One socket cannot push unbounded memory through the channel layer. |
| cursor offset | 0 … 10,000,000 | A hostile frame cannot store an absurd integer. |

---

## Server → client

| Type | Fields | When |
| --- | --- | --- |
| `system.pong` | `sentAt` | Echoing a ping. |
| `document.sync` | `documentId`, `content`, `revision` | On join, and after a rejected stale write. |
| `document.presence` | `documentId`, `participants[]` | On join. The full roster. |
| `document.join` | `documentId`, `participant` | Someone else opened the document. Additive. |
| `document.leave` | `documentId`, `userId` | Someone closed it or dropped. |
| `document.update` | `documentId`, `content`, `revision`, `actorId` | Someone else's edit landed. |
| `document.saved` | `documentId`, `revision`, `savedAt` | **Your own** edit landed. |
| `document.cursor` | `documentId`, `userId`, `cursor` | Someone else moved their caret. |
| `document.error` | `documentId`, `message`, `code` | Something was refused. |

A writer receives `document.saved` and **not** `document.update` for its own
edit — echoing it back would fight the author's own cursor.

### Participant

```json
{
  "user": { "id": "…", "name": "Raj Kumar", "avatarUrl": null },
  "state": "online",
  "colorIndex": 3,
  "documentId": "…",
  "cursor": null,
  "lastSeenAt": "2026-08-04T10:15:00+00:00"
}
```

`state` is one of `online`, `idle`, `editing`, `offline`.

`colorIndex` is assigned by the **server**, as a stable hash of the user id, so
everyone sees the same person in the same colour. Deriving it client-side from
join order would give every client a different mapping.

`cursor` in a roster entry is always `null` — see
[Cursors](#cursors-are-never-stored).

### Error codes

| Code | Meaning |
| --- | --- |
| `UNAUTHENTICATED` | No or invalid token. Connection closes with 4001. |
| `FORBIDDEN` | No access to this document. Closes with 4003. |
| `READ_ONLY` | Viewer role attempted an edit. |
| `DOCUMENT_MISMATCH` | Frame named a different document than the socket. |
| `MALFORMED` | Frame was unusable or over a limit. |
| `INTERNAL` | Unexpected server fault. |

---

## Synchronisation model: SERVER AUTHORITATIVE

The server's stored content is the single source of truth.

1. A client sends `document.update` with the `baseRevision` it edited against.
2. If that matches the server's current revision, the write is accepted, the
   revision increments, and the room is broadcast the new content.
3. If it does not match, someone else saved first. **The write is refused and
   the client is sent `document.sync`** with the authoritative content, which
   it rebases onto.

An accepted write is last-writer-wins.

### This is not OT and not a CRDT

Two people typing in the same paragraph at the same instant **will clobber one
another**. There is no transform and no merge — the loser is re-synced and
their in-flight keystrokes are lost.

That is a real limitation, stated plainly because claiming otherwise would
misrepresent the code. Every edit already flows through one service function
behind one revision check, which is the seam a real merge algorithm would slot
into later. Nothing today occupies that seam.

---

## Trust model

**Identity is never taken from a frame.** The user comes from the token on the
connection. A client that could name its own user id could impersonate anybody
in the room.

**The document is never selected from a frame.** The socket is bound to one
document by its URL, validated once at connect. A frame whose `documentId`
disagrees is refused with `DOCUMENT_MISMATCH` — it is not honoured, and it does
not redirect the connection.

**Roles apply identically to REST and sockets.** A viewer connects, sees
presence, receives live updates and may share a cursor — but their
`document.update` is refused with `READ_ONLY`.

**Origin is validated.** `AllowedHostsOriginValidator` checks the browser's
`Origin` against `ALLOWED_HOSTS`. Without it any website could open a socket in
a logged-in user's browser and read their documents — the WebSocket equivalent
of a missing CORS policy, which the same-origin policy does not cover.

---

## Presence

Presence is temporary state and is **never written to PostgreSQL**. The roster
lives in the cache — Redis in any real deployment — under
`presence:document:<id>` with a 120-second TTL, so a worker that dies without
running `disconnect` leaves a roster that expires by itself rather than a ghost
that stays forever.

The roster is read-modify-write, which two simultaneous joins can race: the
later write can drop the earlier participant. The consequence is a transiently
missing face, repaired by the next presence write and bounded by the TTL.
Presence is soft state by definition, so a lock and its contention would cost
more than the defect.

### Cursors are never stored

Cursor frames arrive as fast as a person can move a caret. They are relayed
through the channel layer straight to the room and written **nowhere** — not to
PostgreSQL, and not to Redis.

The visible consequence: someone joining an active document sees no cursors
until each person next moves. That is a fair trade for not running a
write-per-keystroke workload, and the gap closes within a keystroke.

---

## Versioning under realtime editing

Socket edits do **not** snapshot a version per frame — that would be a
keylogger, not version history. `apply_realtime_update` writes a version when
either:

- the previous version was somebody else's, so a handover is never lost inside
  another person's session; or
- this person's last snapshot is older than 5 minutes.

Explicit REST saves (`PATCH /api/documents/<id>/`) always snapshot.

Activity entries coalesce separately, per person per 10 minutes.

---

## Connection lifecycle

```
  client                                    server
    │                                         │
    ├── handshake + Sec-WebSocket-Protocol ──►│  authenticate
    │                                         │  authorize
    │◄─ accept (subprotocol echoed) ──────────┤  group_add
    │◄─ document.sync ────────────────────────┤
    │◄─ document.presence ────────────────────┤
    │                                         ├─► document.join to the room
    │                                         │
    ├── document.update ─────────────────────►│  revision check, persist
    │◄─ document.saved ───────────────────────┤
    │                                         ├─► document.update to the room
    │                                         │
    ├── document.cursor ─────────────────────►├─► document.cursor to the room
    │                                         │
    ├── close / drop ────────────────────────►│  roster removal
    │                                         ├─► document.leave to the room
```

### Reconnection

The server holds no per-connection state that survives a drop, so reconnecting
is a fresh connect. A client that reconnects should send `document.join`, which
returns `document.sync` and `document.presence` — recovering *state*, not
merely restoring a pipe.

Edits made while disconnected are the client's responsibility to replay; they
will be refused as stale if the document moved on, and the client rebases onto
the `document.sync` it receives.

`system.ping` / `system.pong` exist because a half-open TCP connection looks
alive until something writes to it. An application-level ping is the only thing
that detects that.

---

## Deployment

The channel layer must be **Redis** in any deployment with more than one
worker. A broadcast from the worker holding one socket has to reach clients
held by every other worker; an in-memory layer silently confines it to one
process, which looks fine in development and fails in production.

Run an ASGI server, not WSGI:

```bash
daphne  config.asgi:application --port 8000 --bind 0.0.0.0
uvicorn config.asgi:application --host 0.0.0.0 --port 8000
```

`manage.py runserver` serves WebSockets in development because `daphne` is
first in `INSTALLED_APPS`.

For a Redis-less laptop, `DJANGO_USE_REDIS=False` substitutes in-process
backends. Presence and broadcasts then only reach sockets on the same worker —
fine for one `runserver` process, and proof of nothing about production.
