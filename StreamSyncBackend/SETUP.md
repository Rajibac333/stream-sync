# StreamSync Backend — Setup & Architecture

Operational guide for the backend. `README.md` in this directory is the
engineering specification and is the authority on *what* to build; this file
covers *how to run* what exists today.

**Current state: Milestones 1–10 complete (foundation, authentication,
workspaces, projects & documents, tasks & comments, version history &
activity, real-time collaboration, notifications & background jobs, AI
assistant, production audit).**

The production audit — what was inspected, what was fixed, what is verified and
what is explicitly *not* production-ready — is in
[`docs/PRODUCTION.md`](docs/PRODUCTION.md). Read its "Known limitations"
section before deploying anything.

The frontend is integrated against this API and verified end to end in a
browser; see [`../INTEGRATION.md`](../INTEGRATION.md) for how to run the two
together, what was fixed to make them fit, and the live Playwright suite.

---

## What exists

| Area | Status |
| --- | --- |
| Django + DRF project, split settings | Done |
| PostgreSQL configuration | Done |
| Environment configuration (`.env`) | Done |
| Custom `User` model (UUID key, email login) | Done |
| CORS | Done |
| Health + readiness endpoints | Done |
| Uniform JSON error envelope | Done |
| Structured logging + request correlation | Done |
| OpenAPI schema and docs | Done |
| Docker foundation | Done (build not verified — no Docker on the dev machine) |
| Registration, login, logout, current user | Done |
| Google Sign-In (verified ID token, auto-register/link) | Done |
| JWT access + rotating refresh tokens | Done |
| Refresh token as httpOnly cookie | Done |
| Password validation | Done |
| Rate limiting on credential endpoints | Done |
| Workspaces, membership, roles | Done |
| Workspace isolation | Done |
| Invitations (existing accounts only — see below) | Done |
| Reusable workspace permission classes | Done |
| Project CRUD, filtering, search | Done |
| Document CRUD, filtering, search | Done |
| Initial `DocumentVersion` written transactionally | Done |
| Optimistic concurrency on document edits | Done |
| Task CRUD, assignment, status, priority, due date | Done |
| Comments on documents and tasks, threaded replies | Done |
| Comment resolve/reopen, edit/delete rules | Done |
| Activity records across all major operations | Done |
| Snapshot-per-edit document versions | Done |
| Version listing, restore (forward-writing) | Done |
| Race-safe version numbering | Done |
| Activity timeline endpoint | Done |
| WebSockets (Django Channels + Redis) | Done |
| Authenticated, authorized document rooms | Done |
| Presence, cursors, live document sync | Done |
| Notifications: model, API, unread count, mark read | Done |
| Celery with a Redis broker | Done |
| Retry-safe background notification tasks | Done |
| AI: summarise, action items, improve, ask | Done |
| Provider abstraction + deterministic fallback | Done |
| AI rate limits, timeouts, structured responses | Done |
| Action items proposed, never auto-created | Done |
| Global search across documents, projects, tasks, people | Done |
| Dashboard summary (server-computed counts) | Done |
| pytest suite | Done — 669 tests |
| Password reset | **Not implemented** — see below |
| Task labels | **Not implemented** — see below |

Two known gaps, both deferred for the same reason — Celery is in place, but no
outbound mail pipeline is wired to it yet:

- `POST /api/auth/password-reset/` does not exist. The frontend calls it, so
  that call currently 404s.
- An invitation can only be sent to an email that **already has a StreamSync
  account**. Inviting a stranger means emailing them a signup link. Rather
  than create a placeholder account the invitee could not use, the API returns
  a clear `USER_NOT_REGISTERED` error.

---

## Requirements

- Python 3.12+
- PostgreSQL 14+ (SQLite is not supported)

---

## Local setup

```bash
cd StreamSyncBackend

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements/development.txt

cp .env.example .env
# Set DJANGO_SECRET_KEY and DATABASE_URL in .env
```

Generate a secret key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Create the database:

```sql
CREATE ROLE streamsync WITH LOGIN PASSWORD 'streamsync' CREATEDB;
CREATE DATABASE streamsync OWNER streamsync;
```

`CREATEDB` is required so pytest can create and drop its test database.

Then:

```bash
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

### Note on the local PostgreSQL port

This machine already runs a PostgreSQL 18 server on port **5432** that is
unrelated to StreamSync. The project database was created on a separate
PostgreSQL 14 instance on port **5433**, which is what the committed
`.env.example` comment and the local `.env` refer to. On a clean machine the
default 5432 is fine — only `DATABASE_URL` needs to match reality.

Starting the 5433 instance, if it is not running:

```bash
pg_ctl -D /usr/local/var/postgresql@14 -o "-p 5433" start
```

---

## Docker

```bash
docker compose up --build
```

Brings up `postgres`, `redis` and `backend`, with migrations applied on start
(`RUN_MIGRATIONS=true`). The API is then on <http://localhost:8000>.

Redis is load-bearing: it backs the presence cache, the Channels layer and the
Celery broker. The `worker` service is now enabled and shares the backend image,
so the tasks it runs are byte-identical to the code that queued them.

Running `manage.py runserver` without Docker needs Redis too. For a laptop
without one, `DJANGO_USE_REDIS=False` substitutes in-process backends — see
`docs/WEBSOCKET_PROTOCOL.md` for what that does and does not prove.

---

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health/` | — | Liveness. No dependency checks. |
| GET | `/api/health/ready/` | — | Readiness. Checks database + cache. 503 when degraded. |
| POST | `/api/auth/register/` | — | Create an account, sign in. `201` |
| POST | `/api/auth/login/` | — | Sign in. `200` |
| POST | `/api/auth/google/` | — | Sign in with a verified Google ID token; registers on first use. `200`/`201` |
| POST | `/api/auth/refresh/` | cookie | Rotate the token pair. `200` |
| POST | `/api/auth/logout/` | cookie | Revoke the refresh token. `204` |
| GET | `/api/auth/me/` | bearer | The signed-in user. `200` |
| GET | `/api/workspaces/` | member | My workspaces. Paginated. |
| POST | `/api/workspaces/` | any user | Create one; creator becomes owner. `201` |
| GET | `/api/workspaces/invitations/` | any user | My pending invitations. |
| GET | `/api/workspaces/{id}/` | member | Detail. `404` for non-members. |
| PATCH | `/api/workspaces/{id}/` | **owner** | Rename. Slug never changes. |
| DELETE | `/api/workspaces/{id}/` | **owner** | Delete. `204` |
| GET | `/api/workspaces/{id}/members/` | member | Members + pending invites. |
| POST | `/api/workspaces/{id}/invitations/` | **owner** | Invite. `201` |
| POST | `/api/workspaces/{id}/invitations/accept/` | invitee | Accept. `200` |
| PATCH | `/api/workspaces/{id}/members/{mid}/` | **owner** | Change role. |
| DELETE | `/api/workspaces/{id}/members/{mid}/` | owner or self | Remove or leave. `204` |
| GET | `/api/projects/` | member | List. `?workspace= &status= &search= &ordering=` |
| POST | `/api/projects/` | **editor+** | Create. `201` |
| GET | `/api/projects/{id}/` | member | Detail. `404` for non-members. |
| PATCH | `/api/projects/{id}/` | **editor+** | Update. Slug never changes. |
| DELETE | `/api/projects/{id}/` | **owner** | Delete. Documents survive. `204` |
| GET | `/api/documents/` | member | List, no bodies. `?workspace= &project= &search= &ordering=` |
| POST | `/api/documents/` | **editor+** | Create + version 1. `201` |
| GET | `/api/documents/{id}/` | member | Detail, with body and `revision`. |
| PATCH | `/api/documents/{id}/` | **editor+** | Edit. `409` on stale `revision`. |
| DELETE | `/api/documents/{id}/` | **editor+** | Delete. `204` |
| GET | `/api/tasks/` | member | List. `?workspace= &project= &assignee= &status= &priority= &search= &ordering=` |
| POST | `/api/tasks/` | **editor+** | Create. `201` |
| GET | `/api/tasks/{id}/` | member | Detail. |
| PATCH | `/api/tasks/{id}/` | **editor+** | Partial update. |
| DELETE | `/api/tasks/{id}/` | **editor+** | Delete. `204` |
| GET | `/api/comments/` | member | Threads on a resource. `?resource_type= &resource_id=` |
| POST | `/api/comments/` | member | Start a thread. `201` |
| POST | `/api/comments/{id}/replies/` | member | Reply; returns the thread. `201` |
| PATCH | `/api/comments/{id}/` | see below | `body` (author) or `resolved`. |
| DELETE | `/api/comments/{id}/` | author or **owner** | Delete. `204` |
| GET | `/api/documents/{id}/versions/` | member | History, newest first. Paginated. |
| POST | `/api/documents/{id}/versions/{vid}/restore/` | **editor+** | Restore forward. `200` |
| GET | `/api/activity/` | member | Timeline. `?workspace= &action= &entity_type= &entity=` |
| GET | `/api/notifications/` | any user | Mine. `?unread=true &type= &workspace=` |
| GET | `/api/notifications/unread-count/` | any user | `{"unread_count": 3}` — the badge. |
| PATCH | `/api/notifications/{id}/` | recipient | `{"read": true\|false}` |
| POST | `/api/notifications/mark-all-read/` | any user | `{"updated": 7}` |
| POST | `/api/ai/summarize/` | member | Summary, key points, decisions. |
| POST | `/api/ai/action-items/` | member | **Proposals only** — creates nothing. |
| POST | `/api/ai/improve/` | member | Rewrite: improve, shorten, expand, tone. |
| POST | `/api/ai/ask/` | member | Answer about one document, with citations. |
| POST | `/api/ai/action-items/tasks/` | **editor+** | The confirmation step. Creates tasks. `201` |
| GET | `/api/search/` | member | Documents, projects, tasks and people. Flat, ranked, capped. `?q= &workspace=` |
| GET | `/api/dashboard/` | member | Workspace counts + collaborator strip. `?workspace=` |
| WS | `/ws/documents/{id}/` | bearer subprotocol | Real-time collaboration. See `docs/WEBSOCKET_PROTOCOL.md`. |
| GET | `/api/schema/` | — | OpenAPI 3 document |
| GET | `/api/docs/` | — | Swagger UI |
| GET | `/api/redoc/` | — | ReDoc |
| — | `/admin/` | session | Django admin |

Liveness and readiness are separate on purpose: a database blip should remove
an instance from the load balancer, not cause the orchestrator to restart every
pod — restarting does not bring the database back.

---

## Commands

```bash
pytest                            # full suite
pytest --cov                      # with coverage
ruff check .                      # lint
ruff format .                     # format
python manage.py check            # system checks
python manage.py check --deploy   # production security checks
python manage.py makemigrations --check --dry-run
```

`--deploy` must be run against production settings:

```bash
DJANGO_SETTINGS_MODULE=config.settings.production \
DJANGO_SECRET_KEY=... DJANGO_ALLOWED_HOSTS=... CORS_ALLOWED_ORIGINS=... \
python manage.py check --deploy
```

---

## Architecture

```
config/settings/     base -> development | production | test
config/urls.py       table of contents; no views
apps/<domain>/       one app per product domain
common/              cross-cutting: models, exceptions, pagination,
                     middleware, permissions, logging
tests/               mirrors the app layout
```

The dependency direction is one-way: `apps/*` import from `common`, never the
reverse. That keeps shared code free of the circular imports that appear once
shared modules start reaching back into features.

Per README §35–36, views stay thin — authenticate, validate, authorize, call a
service, respond — and multi-step workflows belong in `services.py` modules
inside each app, added as those milestones land.

### Settings

`base.py` holds everything environment-independent. `production.py` reads its
security-critical values with **no default**, so a missing `DJANGO_SECRET_KEY`
stops the process at boot instead of silently weakening a live deployment.
`tests/test_configuration.py` asserts that this actually happens.

### Errors

Every API error uses one envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The submitted data was invalid.",
    "details": { "email": ["Enter a valid email address."] }
  }
}
```

Clients branch on `code`, which is stable; `message` is human-facing and may be
reworded freely. `common/exceptions/handlers.py` covers errors raised inside
DRF views; `common/exceptions/views.py` covers the ones that never reach a view
(unrouted URL, rejected Host header, middleware crash), which would otherwise
return HTML to a client that asked for JSON.

Unexpected 5xx responses are deliberately opaque — exception text routinely
contains connection strings — and the detail goes to the logs instead.

### Logging

Readable lines locally, one JSON object per line in production. Every record
carries a request id, taken from an inbound `X-Request-ID` (sanitised) or
generated, and echoed back on the response so a user-reported failure maps to
exact log lines. Fields whose names look credential-shaped (`password`,
`token`, `api_key`, `authorization`, …) are redacted before they are written.

### Authentication

Two tokens with different jobs:

| | Lifetime | Delivered as | Held by the browser in |
| --- | --- | --- | --- |
| Access | 15 min | response body | JavaScript memory |
| Refresh | 7 days | httpOnly cookie | the cookie jar, unreadable by JS |

The refresh token never appears in a response body. An XSS can therefore act as
the user while the page is open, but cannot steal a credential that outlives
the tab — which is the difference between one incident and a persistent
account takeover.

Refresh tokens **rotate**: every call to `/api/auth/refresh/` blacklists the
token presented and issues a new one, so a captured refresh token is usable at
most once. Logout blacklists it too — without that, "sign out" would only
delete a cookie while the token itself stayed valid for a week.

The user is re-read from the database on every refresh rather than trusted from
the token's claims, so deactivating an account takes effect within one
access-token lifetime instead of one refresh-token lifetime.

Wrong password and unknown account return an identical 401. Distinguishing them
would turn the login form into an oracle for discovering which emails are
registered.

Login and registration are rate-limited per IP (`10/min` and `5/hour` by
default). This slows online password guessing; it is not a substitute for
per-account lockout or MFA, neither of which exists yet.

### Workspaces, roles and isolation

A workspace is the tenant boundary. Every project, document and task added in
later milestones hangs off one, and every permission question reduces to "does
this user hold an active membership here, and what is its role?"

| | Read | Create/edit content | Workspace settings, members |
| --- | --- | --- | --- |
| Viewer | yes | no | no |
| Editor | yes | yes | no |
| Owner | yes | yes | yes |

Editors deliberately cannot invite members or change roles. An editor who could
would be able to promote themselves to owner, which would make the distinction
between the two roles meaningless.

**Isolation is enforced by the queryset, not by a permission check.** Every
workspace endpoint starts from `visible_workspaces(request.user)` in
`apps/workspaces/views.py`, so a workspace the caller does not belong to is not
forbidden — it is absent, and the response is **404, not 403**. A 403 would
confirm the workspace exists and let an attacker enumerate ids. Permission
classes then decide what a member may do once past that boundary.

That makes `visible_workspaces` the one function to audit, and the one every
later milestone must reuse rather than reimplement.

Two invariants are enforced in the service layer because the database cannot
express them:

- The owner's role cannot be changed and the owner cannot be removed.
  Otherwise `Workspace.owner` would point at someone without the owner role —
  two sources of truth disagreeing, with nobody able to administer the
  workspace.
- Nobody can be invited or promoted *to* owner. Ownership is transferred, which
  is a separate operation and is not yet implemented.

### Invitations

An invitation is a membership row with `status="invited"`, not a separate
resource. That is deliberate and matches the frontend's own reasoning: an
invited person already occupies a seat, counts toward the member total, and is
revoked through exactly the same endpoint that removes an active member. Two
resources would mean two lists, two removal paths, and a distinction the UI
would have to explain.

An invitation reserves a seat; it does not grant access. A pending invitee gets
404 on the workspace until they accept, and the workspace does not appear in
their switcher — it appears under `/api/workspaces/invitations/`.

### Projects and documents

Both are workspace-owned and carry no access rules of their own: membership in
the parent workspace is what grants access. Both route their querysets through
`scoped_to_user_workspaces` in `apps/workspaces/selectors.py` — the same
isolation chokepoint the workspace endpoints use — so a row in another tenant
is absent rather than forbidden, and the response is 404.

Viewers are read-only. Editors and owners create and edit. Deleting a *project*
is workspace-owner only, because it destroys shared structure; deleting a
document is editor-level.

A document may optionally belong to a project, and the link is guarded in both
directions: filing a document under a project from another workspace is
rejected rather than ignored. Deleting a project leaves its documents in place
and unfiled (`SET_NULL`), because losing a folder should not destroy the work
inside it.

### Version history

**Document creation writes version 1 in the same transaction**, and every
subsequent content change appends another. A rename does not — it changes no
text there would be anything to restore — and neither does saving identical
content, which would otherwise let autosave flood the history.

`DocumentVersion.save()` refuses to modify an existing row. History that can be
edited is not history, so the model rejects the wrong approach outright rather
than trusting callers.

**Restore writes forward.** Restoring version 5 creates version 6 containing
version 5's content. Version 5 is untouched and versions 6..N are not removed,
so undoing a restore is just another restore. History only ever grows.

#### Version numbering and the race

`next_version_number()` is `MAX(version_number) + 1` — a read-then-write. Two
simultaneous saves would both read 5, both try to insert 6, and one would die
on the unique constraint. Two things prevent that, in order:

1. Every path that appends a version first takes a `select_for_update` lock on
   the **document** row (`lock_document`). Locking the document rather than the
   version table means writes to *different* documents still run in parallel.
2. The unique constraint on `(document, version_number)` remains as the
   backstop, so a future code path that forgets the lock gets a rejected insert
   rather than two rows both claiming to be version 6.

`tests/documents/test_version_concurrency.py` runs six genuinely concurrent
transactions to prove it. Removing the lock makes the restore and revision
tests fail: without it, six writers all wrote `revision=2` — a textbook lost
update.

Worth knowing why the *edit* tests are less sensitive than the restore ones:
`update_document` saves the document before appending its version, and that
UPDATE takes an implicit row lock which accidentally serialises the insert
behind it. `restore_version` appends first, so nothing but the explicit lock
protects it. The lock is load-bearing, not belt-and-braces.

Editing advances a `revision` counter. Sending `revision` with a PATCH makes
the write conditional: a mismatch returns **409** rather than silently
overwriting whoever saved first. A rename does not advance it, so renaming a
document cannot invalidate an edit somebody else is composing.

Two performance decisions worth knowing:

- The list endpoint calls `defer("content")`. Bodies are the largest column in
  the schema and the list does not render them; the denormalised `excerpt`
  column carries the preview. A test asserts against the emitted SQL, because
  a response that omits `content` proves nothing on its own — the serializer
  would omit it either way, having already paid to read it.
- `select_related` and `prefetch_related` keep both lists flat in the number of
  rows returned. Query-count tests measure a baseline and assert the count is
  unchanged after adding more rows.

Search is `icontains` across name/description and title/body. Honest for the
current scale; a GIN/trigram index or a stored `tsvector` is the upgrade path
when these tables grow — measured, not guessed. `?ordering=` is restricted to
an allowlist, since an open ordering parameter lets a caller sort by any
column, including ones on joined tables.

### Tasks

Statuses are `todo / in_progress / review / done`; priorities are
`low / medium / high / urgent`. Both are lowercase on the wire to match the
frontend unions.

A task **requires** a project and cascades with it — the opposite of a
document, deliberately. A document is a standalone artefact that outlives the
folder it sat in; a task is a unit of work *within* a project and means nothing
without one. The frontend types `projectId` as non-null for the same reason.

An assignee must be an active member of the workspace. Assigning to an outsider
is rejected rather than accepted: an assignee who cannot open the task is a
silent dead end, and it would leak the task's existence outside the team. An
unknown user id returns the same error as a known non-member, so assignment
cannot be used to discover which user ids exist.

Entering `done` stamps `completed_at`; reopening clears it, so "when was this
finished?" never reports a completion that was undone.

### Comments

One model serves both documents and tasks, addressed by
`(resource_type, resource_id)`. Splitting it would mean two models, two
services and two endpoints for one behaviour — and the frontend reaches for the
same thread UI in both places.

Threads are exactly **one level deep**. Replying to a reply attaches to the
same root rather than erroring: the intent is unambiguous, and arbitrary
nesting produces threads nobody can follow. A reply inherits its resource from
the root, so it cannot be redirected at a different document.

Two database constraints hold what code should not be trusted to: a comment
targets exactly one document *or* task (README §11), and a reply can never be
marked resolved — resolution describes a conversation, not one message in it.

| | Who |
| --- | --- |
| Read | any active member |
| Comment | any active member, **including viewers** |
| Edit body | the author, and nobody else |
| Resolve / reopen | editors and owners, or the thread's author |
| Delete | the author, or the workspace owner |

Two of those are deliberate judgment calls:

- **Viewers can comment.** A viewer who cannot ask a question is not a
  reviewer, and review is the workflow the role exists for. They stay
  read-only for documents, tasks and projects.
- **Not even the owner can edit someone else's comment.** Deleting another
  person's comment is moderation; rewriting it is putting words in their mouth,
  and no role carries that. Edits stamp `edited_at` so the UI can say so rather
  than silently rewriting the record.

`GET /api/comments/` returns a **bare array**, not the paginated envelope. This
deviates from README §48 knowingly: the client renders a whole thread at once,
and a comment panel that paged would hide half a conversation. Threads are
bounded by the resource they hang off. If they ever grow past that assumption,
pagination needs a coordinated frontend change.

### Activity

Append-only. `Activity.save()` refuses to modify an existing row, and the admin
disables add, change and delete — an audit trail that can be rewritten proves
nothing.

The target is a loose `(entity_type, entity_id)` pair rather than a foreign key.
A foreign key would either block deletion of the thing it describes or cascade
the history away with it, and "Raj deleted the task" is precisely the entry that
must survive the task's deletion. The target's display name and the actor's name
are copied into `metadata` at write time for the same reason.

`record()` never raises. It runs inside the transactions that create tasks and
comments, and losing a log line beats losing the user's work — so it returns
`None` and logs the failure instead. The **savepoint** inside it is what makes
that promise keepable: a failed query marks the *enclosing* transaction for
rollback, so catching the exception without one would leave the outer
transaction broken and every later query raising `TransactionManagementError`.
`tests/activity/test_activity_records.py` proves this with a real database
error; without the savepoint the whole task creation 500s.

`GET /api/activity/` serves the timeline, newest first, filterable by
workspace, action, entity type, or a single object's id (`?entity=` powers a
"what happened to this document" panel). It is **read-only** — there is no
endpoint that creates, edits or deletes an entry.

Entries are recorded for: project created, document created, document edited,
task created, task completed, member invited, and comments added. Only the
*transition* into done is recorded for a task; logging every field change would
bury the events people actually look for.

Repeated edits to one document by one person **collapse into a single feed
entry** within a 10-minute window. Versions still capture every save — this
de-duplicates only the timeline, which is otherwise unreadable during an
editing session. Coalescing is per person, so it never hides who else was
working. Restores deliberately bypass it: two restores are two facts, and
"Restored version 2" is exactly the entry someone comes looking for.

### Real-time collaboration

`ws://…/ws/documents/<id>/`, served by Django Channels over a Redis channel
layer. The full protocol — frames, close codes, trust model, presence semantics
— is in **`docs/WEBSOCKET_PROTOCOL.md`**. The essentials:

- **Auth is a bearer token in `Sec-WebSocket-Protocol`**, because a browser
  cannot set headers on a WebSocket and a token in the query string leaks into
  access logs. The server must echo the subprotocol back or the handshake
  fails.
- **A rejected socket is accepted then closed with 4001/4003.** Closing before
  accepting surfaces as 1006, which the client cannot distinguish from a
  network blip — it would retry a credential that will never work.
- **Authorization runs before the room is joined**, through the same
  `scoped_to_user_workspaces` chokepoint as REST, so a rejected socket never
  receives a broadcast.
- **Identity and document are never taken from a frame.** The user comes from
  the token; the document from the URL. A frame naming a different document is
  refused, not honoured.
- **Viewers connect, watch and share cursors, but cannot edit.** The role means
  the same thing here as over REST.
- **Cursors are stored nowhere** — not PostgreSQL, not Redis. They are relayed
  through the channel layer and forgotten.
- **Presence lives in Redis with a TTL**, so a worker that dies without
  disconnecting leaves a roster that expires rather than a permanent ghost.

#### Synchronisation: server authoritative, and nothing more

The server's copy is the truth. A client sends the `baseRevision` it edited
against; a mismatch is refused and the client receives `document.sync` with the
authoritative content to rebase onto. An accepted write is last-writer-wins.

This is **not** OT and **not** a CRDT. Two people typing in the same paragraph
at the same instant will clobber one another. Every edit flows through one
service function behind one revision check, which is the seam a real merge
algorithm would occupy — nothing occupies it today.

### Notifications and background jobs

A notification is addressed to one person about one thing, and is **composed at
write time** — title, body and link are stored, not derived on read — so it
still reads correctly after the task it refers to is renamed or deleted. Same
reasoning as the activity log.

Generated for: task assignment, task completion (to the task's *creator*),
mentions, project status changes, and workspace invitations.

#### Two rules keep the list quiet

- **Nobody is notified about their own action.** Assigning a task to yourself
  or mentioning yourself pings nobody. This is the single biggest source of
  notification noise.
- **One unread notification per (recipient, type, entity).** Reassigning a task
  three times leaves one unread ping, not three. Once you have read it, a new
  event notifies again — dedupe collapses unread pings, it does not silence a
  topic forever.

The second rule is a **partial unique constraint**, not just a service check.
That is what makes the Celery tasks genuinely idempotent: a task redelivered
after a worker died cannot write a second copy, even racing the check.

The entity for a mention is the *comment*, not the document, so two mentions in
two conversations are two notifications.

#### Background jobs

Celery over the Redis broker. Tasks are retry-safe by construction:

- **They take ids, never objects.** A serialised model is a stale snapshot by
  the time a retry runs.
- **A vanished subject is success.** A task deleted between the event and the
  retry means there is nothing to notify about — the task returns instead of
  raising into an infinite retry loop.
- `acks_late` + `reject_on_worker_lost` redeliver work whose worker died, which
  is only safe *because* of the idempotency above.
- Retries back off with jitter, so a recovered outage does not produce a
  synchronised retry storm.

**Dispatch happens in `transaction.on_commit`**, so a worker never reads a row
its transaction has not written, and a rolled-back transaction notifies nobody.

**Every dispatch goes through `common.tasks.enqueue`**, which swallows and logs
broker failures. `on_commit` runs *after* the data is safely written, so an
exception there would turn an already-committed "assign a task" into a 500 and
the user would retry an action that in fact succeeded. A notification is worth
strictly less than the write that caused it. The broker is also configured to
fail fast (2s, no retries) — the defaults retry for ~20 seconds, and that delay
lands directly on a user's request.

`purge_read_notifications` exists for a beat schedule but nothing schedules it
yet. It only ever deletes *read* entries.

### AI assistant

    view  →  apps/ai/services.py  →  apps/ai/providers/*  →  provider

Views validate and authorise; the service layer builds the prompt and validates
the answer; a provider knows one vendor and nothing about StreamSync. No view
imports a provider, and no provider imports a model.

**The key never leaves the server.** `AI_API_KEY` is read in exactly one place
(`apps/ai/providers/__init__.py`, passed to the SDK client) and is never
logged, serialised, or placed in an error payload. Every vendor exception is
translated in `anthropic_provider.py` rather than allowed to propagate,
because an SDK exception renders the request that produced it and one of that
request's headers is the key.

**Two providers.**

| Provider | When | Engine string |
| --- | --- | --- |
| `anthropic` | `AI_API_KEY` is set | the model id, e.g. `claude-opus-5` |
| `mock` | no key, or `AI_PROVIDER=mock` | `mock-heuristic` |

The mock is not a stub that returns canned text: it reads the document and
answers with rules (heading structure, marker phrases, keyword overlap). It is
also not a language model, and nothing labels it as one — the `engine` on every
response is the real identifier of whatever answered, so a UI that shows
provenance shows the truth. It contains no HTTP client and no credentials,
which is what makes "no external AI calls during tests" structural rather than
a convention: `config/settings/test.py` pins `AI_PROVIDER = "mock"` and blanks
the key, so an exported `AI_API_KEY` cannot flip the suite onto a live provider
and bill you for it.

**Structured responses.** Each operation names a JSON Schema
(`apps/ai/schemas.py`) and the model is constrained to it. The reply is still
validated on the way out: constrained decoding guarantees the *shape*, not that
the response finished, and a truncated reply is valid JSON up to the point it
stops. A malformed answer becomes `AI_INVALID_RESPONSE` (503), never a 500.

**Two claims the server does not take on trust.** A rewrite that reports
`changed: true` is checked against the text it returned, and an answer with
`grounded: false` has its citations dropped — an "it doesn't say" that comes
with sources contradicts itself. Both are lies a user would act on.

**Action items are proposals.** `POST /api/ai/action-items/` writes nothing.
Tasks exist only after the client posts the (user-edited) items to
`POST /api/ai/action-items/tasks/`, and extraction is *not* re-run there — what
gets created is what was on screen. The model returns an assignee *name*, never
an id; names are resolved against active workspace membership server-side, and
an unmatched name yields an unassigned proposal rather than an invented user.

**Failure and cost.**

| Situation | Status | Code |
| --- | --- | --- |
| Provider unreachable or failing | 503 | `AI_SERVICE_UNAVAILABLE` |
| Past the request budget | 504 | `AI_TIMEOUT` |
| Provider rate-limited us | 429 | `AI_RATE_LIMITED` |
| Unusable or truncated answer | 503 | `AI_INVALID_RESPONSE` |
| Provider declined the content | 422 | `AI_REFUSED` |
| Live provider, no credentials | 503 | `AI_NOT_CONFIGURED` |

Timeout is `AI_TIMEOUT_SECONDS` (45s) with one retry — a budget, not a hope,
since the SDK's default would hold a worker for ten minutes. Two per-user
throttles apply to every AI endpoint: `ai_burst` (10/min) catches a client
stuck in a retry loop, `ai` (60/hour) bounds what one account can spend. They
are keyed on the account, not the address, so an office behind one NAT does not
share a budget.

**Logs record the operation, not the document**: which operation, which
document id, how long, which engine, token counts. Never the prompt, the
document body, or the answer.

### The User model

UUID primary key, email as the login identifier, and a case-insensitive unique
constraint on email so two accounts cannot differ only by capitalisation.
`avatar_url` and `title` match the frontend's `User` contract in
`StreamSyncFrontend/src/types/auth.ts`.

Workspace roles are deliberately **not** fields on `User` — a role describes a
relationship to one workspace, not a global property of the account, and
belongs on the membership model in Milestone 3.

---

## Security posture

- `IsAuthenticated` is the project-wide default; public endpoints opt out
  explicitly, so a view added without a permission line fails closed.
- `DEFAULT_AUTHENTICATION_CLASSES` is JWT only. DRF's default would also enable
  `BasicAuthentication`, which accepts a password on *every* request and would
  hand an attacker a brute-force surface the login throttle does not cover.
- The refresh token is httpOnly, Secure in production, SameSite, and
  path-scoped to `/api/auth/`.
- Registration accepts exactly three fields, so `is_staff` cannot be
  self-assigned by posting extra keys.
- CORS is an explicit origin allow-list with credentials enabled — never a
  wildcard — and is confined to `/api/` so the admin stays same-origin.
- Production forces HTTPS, HSTS and secure cookies, and refuses to boot
  without its required environment variables.
- The container runs as a non-root user.
- `.env` is git-ignored; only `.env.example` is committed.

Not yet addressed: per-account lockout, MFA, password reset, and email
verification. Refresh tokens accumulate in `token_blacklist` and need the
`flushexpiredtokens` command on a schedule before this runs in production.

---

## Frontend integration note

One mismatch to resolve before switching `VITE_API_MODE` to `live`.

`StreamSyncFrontend/src/api/client.ts` → `normalizeError()` reads DRF's native
error shapes: a top-level `detail` string and top-level `{field: [messages]}`.
This backend returns the envelope README §18 mandates:

```json
{ "error": { "code": "...", "message": "...", "details": { "email": ["..."] } } }
```

Nothing breaks — the client falls back to its generic per-status messages — but
until it is updated it will **drop field errors and specific messages**, so a
signup form cannot show "An account with this email already exists." next to
the email input.

The fix is confined to those two helper functions: read `data.error.message`
for the message and `data.error.details` for the field errors. The backend
shape should not change; §18 is explicit, and the whole API already conforms.

A third gap, in `StreamSyncFrontend/src/types/notification.ts`: the
`NotificationType` union has no `workspace_invitation` entry, and the API emits
one — README §13 lists invitations as notifiable and the product has them. It
needs one line in the union and one in any label map. The frontend also has no
call for `GET /api/notifications/unread-count/`, which is what should drive the
badge rather than counting an unread filter client-side.

`document_shared` exists in both the frontend union and the model's choices, but
**nothing emits it**: document sharing is not a backend feature. The endpoints
`documentsApi.shares()` and `updateShareRole()` call still 404.

A second, smaller mismatch: `PROJECT_STATUS_LABELS` in
`StreamSyncFrontend/src/types/project.ts` has no entry for `archived`.

README §7 specifies ACTIVE / ARCHIVED / COMPLETED while the frontend already
ships planning / active / on_hold / completed. Rejecting `planning` would break
a UI that is already built, and omitting `archived` would contradict the backend
spec, so the model supports the **union of both**. Nothing sets `archived` today
— there is no archive action — so the gap is latent, but adding the label entry
is a one-line change that should happen before one exists.

Everything else already lines up: snake_case wire format, `avatar_url`/`title`
serialised as `null` rather than `""`, `{user, access, expires_at}` session
payload, `/auth/refresh/` returning the user so `getSession()` restores a
session in one round trip, the workspace payloads matching `api/workspaces.ts`
field for field, and the project and document payloads matching
`api/projects.ts` and `api/documents.ts` — including `member_count`, lowercase
role values, `status` on every member row, `project_name` denormalised onto each
document, and `content`/`revision` present only on the detail endpoint.

Two fields remain intentionally constant, and both are accurate rather than
placeholders:

- `active_collaborator_ids` on a document is always `[]`. Presence arrives over
  the WebSocket in Milestone 7, so nobody is connected.
- `labels` on a task is always `[]`. Labels are a workspace-level catalogue
  with their own `/api/labels/` endpoint in the frontend, and they appear in
  neither README §10 nor Milestone 5's scope, so the model was not built. The
  frontend sends `label_ids` on task create/update and it is **not** accepted —
  the key is simply ignored — and `GET /api/labels/` currently 404s. Wiring
  labels up is a small, self-contained piece of work whenever it is wanted.

(`task_count` / `completed_task_count` were constants through Milestone 4 and
are now real queryset annotations.)

---

## Frontend integration: version history

`documentsApi.versions()` in `StreamSyncFrontend/src/api/documents.ts` currently
does `api.get<DocumentVersion[]>(...)` with **no DTO mapper** — unlike every
other resource, which maps snake_case to camelCase. Two changes are needed:

1. Add a `toVersion` mapper alongside the existing `toDocument`, mapping
   `{number, author: {avatar_url}, is_current, created_at}` to
   `{number, author: {avatarUrl}, isCurrent, createdAt}`.
2. Read `.results` — the endpoint is paginated, per README §48, like every
   other list.

The backend deliberately emits snake_case here rather than matching the app
type directly. One camelCase endpoint would be a permanent wart in the API to
paper over a missing six-line frontend function.

`restoreVersion()` already matches: it returns the updated document, which the
existing `toDocument` handles.

---

## Next: Milestone 10

Production readiness: a review of architecture, the API and WebSocket layers,
authentication, security, performance, deployment and documentation. No new
feature surface — the work is verifying and hardening what exists.

Known gaps carried forward, all deliberately out of scope so far and all listed
above: password reset (`POST /api/auth/password-reset/` still 404s), inviting
an email that has no account yet, ownership transfer, task labels
(`/api/labels/`), document sharing (`documentsApi.shares()` — which is why
nothing emits a `document_shared` notification), and a beat schedule for
`purge_read_notifications`.

Docker remains **written but unverified**: no Docker daemon has been available
on this machine, so `docker compose up` has never actually run here. That is a
claim to test in Milestone 10, not one to repeat.

Two operational notes for a real deployment:

- Set `AI_API_KEY` to switch from the deterministic provider to Claude. Nothing
  else changes — no code, no endpoint, no client. Leaving it unset is a
  supported configuration, not a broken one.
- The AI throttle rates (`DJANGO_THROTTLE_AI_BURST`, `DJANGO_THROTTLE_AI`) are
  the only spend control in front of a paid API. Tune them before opening the
  product to real traffic.
