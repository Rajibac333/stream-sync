# StreamSync Backend — Production Audit

Audit date: 2026-08-08 · Commands re-run at the end of this document.

This is the record of a full production audit of the backend: what was
inspected, what was found, what was fixed, and — as importantly — what is *not*
production-ready and why. Nothing below is described as verified unless it was
actually exercised on this machine.

---

## 1. Architecture

```
                    Browser (React SPA)
                       │            │
                REST over HTTPS   WebSocket
                       │            │
                       ▼            ▼
        ┌──────────────────────────────────────┐
        │  ASGI app  (gunicorn → uvicorn)      │
        │                                      │
        │  DRF views ──► services ──► models   │
        │  Channels consumer ──► services      │
        │  AI views ──► AI service ──► provider│
        └───────┬───────────────┬──────────────┘
                │               │
         PostgreSQL          Redis ──────► Celery worker
       (durable state)   (cache, channel      (notifications)
                          layer, presence,
                          throttle counters,
                          Celery broker)
                                              │
                                     Anthropic API (AI only)
```

**Layering rule, enforced throughout:** views validate and authorise; services
own the writes and the transactions; models own the schema. No view contains a
raw multi-step write, and no provider or SDK is imported above the AI provider
package.

**Request path for AI**, which is the one path that leaves the perimeter:
`React → Django → AI service → provider`. The browser never holds a provider
key and never talks to a provider. Verified by `tests/ai/` (72 tests) and by
the absence of any provider import outside `apps/ai/providers/`.

---

## 2. Completed features

| Area | State | Where |
| --- | --- | --- |
| Registration, login, JWT access + refresh, logout, current user | Implemented, tested | `apps/accounts` |
| Workspaces, membership, roles (owner/editor/viewer), invitations | Implemented, tested | `apps/workspaces` |
| Projects | Implemented, tested | `apps/projects` |
| Documents, editing, revision conflict detection | Implemented, tested | `apps/documents` |
| Immutable version history + restore-forward | Implemented, tested | `apps/documents` |
| Tasks: CRUD, assignment, status, priority, due dates | Implemented, tested | `apps/tasks` |
| Comments on documents and tasks, threads, resolve/reopen | Implemented, tested | `apps/comments` |
| Workspace activity timeline | Implemented, tested | `apps/activity` |
| Real-time collaboration over WebSockets | Implemented, tested | `apps/collaboration` |
| Notifications + Celery fan-out | Implemented, tested | `apps/notifications` |
| AI: summarise, action items, improve, ask, confirm-to-tasks | Implemented, tested against a stub provider | `apps/ai` |
| OpenAPI schema | Generated, validates | `docs/openapi.yaml` |

**Not implemented** (see §10): password reset, invite-by-email for people
without an account, ownership transfer, task labels, document sharing
endpoints, CRDT/OT merging.

---

## 3. API endpoints

35 paths, 50 operations, all present in `docs/openapi.yaml`.

```
GET    /api/health/                                   liveness (unauthenticated)
GET    /api/health/ready/                             readiness (unauthenticated)

POST   /api/auth/register/                            throttled 5/hour per IP
POST   /api/auth/login/                               throttled 10/min per IP
POST   /api/auth/refresh/                             throttled 60/hour per IP
POST   /api/auth/logout/
GET    /api/auth/me/

GET    /api/workspaces/                               my workspaces
POST   /api/workspaces/
GET    /api/workspaces/invitations/                   my pending invitations
GET    /api/workspaces/{id}/
PATCH  /api/workspaces/{id}/                          owner
DELETE /api/workspaces/{id}/                          owner
GET    /api/workspaces/{id}/members/
POST   /api/workspaces/{id}/invitations/              owner · throttled 30/hour
POST   /api/workspaces/{id}/invitations/accept/
PATCH  /api/workspaces/{id}/members/{membership_id}/  owner
DELETE /api/workspaces/{id}/members/{membership_id}/  owner, or self-leave

GET    /api/projects/                                 filter, search, order
POST   /api/projects/                                 editor+
GET    /api/projects/{id}/
PATCH  /api/projects/{id}/                            editor+
DELETE /api/projects/{id}/                            editor+

GET    /api/documents/                                filter, search, order
POST   /api/documents/                                editor+
GET    /api/documents/{id}/
PATCH  /api/documents/{id}/                           editor+ · revision-checked
DELETE /api/documents/{id}/                           editor+
GET    /api/documents/{id}/versions/
POST   /api/documents/{id}/versions/{vid}/restore/    editor+ · writes forward

GET    /api/tasks/                                    filter by status/assignee/project
POST   /api/tasks/                                    editor+
GET    /api/tasks/{id}/
PATCH  /api/tasks/{id}/                               editor+
DELETE /api/tasks/{id}/                               editor+

GET    /api/comments/?resource_type=&resource_id=
POST   /api/comments/
POST   /api/comments/{id}/replies/
PATCH  /api/comments/{id}/                            author, or resolve by any member
DELETE /api/comments/{id}/                            author or editor+

GET    /api/activity/?workspace=                      read-only timeline

GET    /api/notifications/                            mine only
GET    /api/notifications/unread-count/
PATCH  /api/notifications/{id}/                       mark read / unread
POST   /api/notifications/mark-all-read/

POST   /api/ai/summarize/                             member · AI throttles
POST   /api/ai/action-items/                          member · proposals only
POST   /api/ai/action-items/tasks/                    editor+ · explicit confirmation
POST   /api/ai/improve/                               member
POST   /api/ai/ask/                                   member

GET    /api/schema/  ·  /api/docs/  ·  /api/redoc/
```

Every error response uses one envelope:

```json
{"error": {"code": "STABLE_CODE", "message": "Human sentence.", "details": {}}}
```

---

## 4. WebSocket protocol

Full protocol: `docs/WEBSOCKET_PROTOCOL.md`. Summary:

```
WS /ws/documents/<document_id>/
Sec-WebSocket-Protocol: streamsync.bearer, <access token>
```

The token rides in the subprotocol because a browser cannot set an
`Authorization` header on a WebSocket, and a token in the query string ends up
in access logs, history and `Referer`.

| Client → server | Server → client |
| --- | --- |
| `system.ping` | `system.pong` |
| `document.join` | `document.join`, `document.sync`, `document.presence` |
| `document.leave` | `document.leave` |
| `document.update` | `document.update` (others), `document.saved` (writer) |
| `document.cursor`, `document.selection` | `document.cursor` |
| | `document.error` |

Close codes: `4001` unauthenticated, `4003` forbidden. Error codes:
`UNAUTHENTICATED`, `FORBIDDEN`, `READ_ONLY`, `DOCUMENT_MISMATCH`, `MALFORMED`,
`INTERNAL`.

**Synchronisation model: server-authoritative, last-writer-wins.** A client
sends the revision it based its edit on; a mismatch is refused and the client
is re-synced from the server's copy. This is **not** OT and **not** a CRDT.
Two people typing in the same paragraph at the same instant will clobber one
another. Frames are flat camelCase; REST is snake_case.

---

## 5. Environment variables

`.env.example` is the complete list and the only env file that may be
committed. Every variable used by `config/settings/*` appears there — verified
by diffing the settings modules against the file during this audit.

**Required in production** (no defaults; the app refuses to boot without them):

| Variable | Purpose |
| --- | --- |
| `DJANGO_SECRET_KEY` | Signing key. 50+ random characters. |
| `DJANGO_ALLOWED_HOSTS` | Host allow-list. |
| `CORS_ALLOWED_ORIGINS` | Explicit browser origins. Never a wildcard — credentials are allowed. |
| `DATABASE_URL` | PostgreSQL DSN. |
| `REDIS_URL` | Cache, channel layer, presence roster, Celery broker. |

**Secret, server-side only:** `DJANGO_SECRET_KEY`, `JWT_SIGNING_KEY`,
`DATABASE_URL`, `AI_API_KEY`. None has a production default; none is logged
(`common/logging.py` redacts any key matching `password`, `token`, `secret`,
`authorization`, `api_key`, `cookie`, `session`, `credential`, with separators
normalised so `X-API-Key` matches).

**Notable optional variables:** `AI_PROVIDER` (`anthropic` | `mock`),
`AI_MODEL`, `AI_EFFORT`, `AI_TIMEOUT_SECONDS`, `AI_MAX_RETRIES`,
`DJANGO_THROTTLE_*` (seven scopes), `JWT_REFRESH_COOKIE_SAMESITE`,
`DJANGO_SECURE_HSTS_*`.

---

## 6. Database structure

PostgreSQL. Every table uses a UUID primary key and `created_at` / `updated_at`
from `common.models.BaseModel`.

```
accounts_user
  └─ owns → workspaces_workspace ──┬─ workspaces_workspacemembership (user, role, status)
                                   ├─ projects_project ──┬─ tasks_task
                                   │                     └─ documents_document (project nullable)
                                   ├─ documents_document ── documents_documentversion (immutable)
                                   ├─ comments_comment (→ document XOR task, self-FK for replies)
                                   ├─ activity_activity (append-only, loose entity_type+entity_id)
                                   └─ notifications_notification (recipient, partial unique on unread)
```

Deletion rules encode intent: `SET_NULL` for a document's project (a document
outlives its folder) and for assignees (removing a person unassigns their work,
it does not delete it); `CASCADE` for a task's project (a task means nothing
without one); `PROTECT` for authorship fields (accounts are deactivated, not
deleted).

**Indexes** — 21 declared plus PostgreSQL's automatic FK and unique indexes.
Every hot path is covered: `(workspace, -updated_at)` on documents, projects
and tasks; `(project, status)` and `(assignee, status)` for boards; a *partial*
unique index on notifications `WHERE is_read = false` that enforces dedupe;
`(user, status)` and `(workspace, status)` on membership, which is the join
behind every isolation check.

**Migrations:** `makemigrations --check` reports no drift; `migrate --check`
reports nothing unapplied.

---

## 7. Deployment

```bash
# 1. Build
docker build -f docker/Dockerfile -t streamsync-backend .

# 2. Migrate — once, as a job, not on every replica start
docker run --rm --env-file .env.production streamsync-backend \
  python manage.py migrate --noinput

# 3. API (ASGI: REST and WebSockets share one deployment)
docker run -d --env-file .env.production -p 8000:8000 streamsync-backend

# 4. Worker
docker run -d --env-file .env.production streamsync-backend \
  celery -A config worker --loglevel=info --concurrency=2
```

The image is two-stage (build tooling never ships), runs as a non-root user,
bakes `collectstatic` into the layer, and has a `HEALTHCHECK` against
`/api/health/`. `RUN_MIGRATIONS=true` exists for local compose only — with N
replicas it means N processes racing on the same schema.

`gunicorn --timeout 120` is deliberate: the AI endpoints' worst case is
`AI_TIMEOUT_SECONDS` (45s) with one retry, and a 60s worker timeout would kill
the worker mid-request and return an opaque 502 instead of the `AI_TIMEOUT` the
application would otherwise produce.

Local development: `docker compose up --build` (Postgres, Redis, API, worker),
or `manage.py runserver` with `DJANGO_USE_REDIS=False` for a laptop with no
Redis — a single-process fallback that proves nothing about multi-worker
behaviour and must never be used outside development.

---

## 8. Security review

### Verified

1. **No secrets committed.** `.env` is git-ignored (`.env*` with an explicit
   `!.env.example` exception) and excluded from the Docker build context. A
   regex sweep for assigned key/secret/password/token literals across `apps`,
   `common`, `config`, `docker`, `tests` and the compose file returned nothing
   outside test fixtures and clearly-labelled placeholders. **Caveat: this
   directory is not a git repository**, so "no secrets in history" could not be
   checked — only that the ignore rules are correct for when it becomes one.
2. **No API key is exposed.** `AI_API_KEY` is read in exactly one place
   (`apps/ai/providers/__init__.py`), held on the SDK client, and never
   serialised, logged or attached to an error. Vendor exceptions are translated
   before they can propagate, because an SDK exception renders the request that
   produced it — headers included. Two tests assert this directly:
   `test_the_provider_does_not_keep_the_key_on_the_instance` and
   `test_the_failure_log_does_not_contain_the_key_or_the_vendor_message`.
3. **Frontend permissions are never trusted.** No endpoint accepts an actor id;
   the user always comes from the authenticated session. Role, workspace and
   document access are re-derived server-side on every request, and the
   WebSocket derives identity from the connection rather than from any frame.
4. **Workspace isolation is enforced at one chokepoint.**
   `scoped_to_user_workspaces()` filters with `Exists()` on active membership,
   and every workspace-scoped queryset in every app routes through it —
   including the WebSocket's authorization check. Because it *filters* rather
   than forbids, a resource in another tenant returns **404, not 403**, so ids
   cannot be enumerated. All views were read during this audit; no unscoped
   queryset reaches a client.
5. **WebSocket authorization is enforced** before the socket joins the room, so
   an unauthorised connection never receives a single broadcast. Frames naming
   a different document than the socket is bound to are refused. Viewers
   connect and watch; their writes are refused.
6. **AI endpoints are protected**: authentication, workspace membership,
   editor role for task creation, two rate limits, request-size caps, a
   per-request timeout, and no automatic task creation.
7. **Sensitive endpoints are rate limited**: login (10/min per IP), register
   (5/hour per IP), refresh (60/hour per IP), invitations (30/hour per user),
   AI (10/min burst + 60/hour sustained per user), plus global anon and user
   limits.
8. **Database queries are reasonable.** Measured, not assumed: a probe scaled
   every list endpoint from 1 to 21 rows and compared query counts. Documents,
   projects, tasks, comments, versions, members, activity, notifications and
   workspaces all stayed **constant**. No N+1 was found.
9. **Important workflows use transactions** — 25 `atomic` blocks across the
   service layer. Notable cases: a document and its first version are written
   together; version numbering takes a `select_for_update` row lock (proven
   necessary — removing it makes concurrent writers collide); activity writes
   use an inner savepoint so a failed log line cannot poison the caller's
   transaction; task creation from AI action items is atomic across the batch.
10. **Errors do not expose internals.** One handler produces every error body.
    5xx detail goes to the logs and the client gets an opaque message.
    `DEBUG=False` is fixed in production settings. `check --deploy` passes with
    no warnings.

### Fixed during this audit

| Severity | Finding | Fix |
| --- | --- | --- |
| High | **WebSocket authorization was decided once, at connect.** A socket is long-lived; removing someone from a workspace or demoting them to viewer took effect over REST immediately and over their open socket not at all — they kept writing until they happened to reconnect. | Writes and re-joins now re-verify access through the same isolation chokepoint, at most once per 60s. Access revoked → socket closed with 4003; role downgraded → writes refused. Two tests; both proven to fail without the fix. |
| High | **Invitations had no dedicated rate limit**, despite README §24 naming them alongside login. Only the global 1000/hour applied to an endpoint that creates memberships and notifications, and will send mail. | `workspace_invite` scope at 30/hour per user. Two tests; proven to fail without the throttle. |
| Medium | **`gunicorn --timeout 60` was below the AI worst case** (~90s). A slow AI request would be killed mid-flight, returning an opaque 502 and restarting the worker instead of the application's own `AI_TIMEOUT`. | Raised to 120s with an explicit `--graceful-timeout 30`. |
| Low | Compose described Redis as not yet used, and passed no `AI_API_KEY`. | Comment corrected; `AI_API_KEY` passed through from the host to the API and worker. |
| Low | `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS` / `_PRELOAD` were readable by settings but undocumented. | Added to `.env.example` with the warning that preload is hard to reverse. |

### Accepted risks (not defects, but worth stating)

- **Access tokens are not re-validated over a live WebSocket.** A socket opened
  with a valid token stays open past the token's 15-minute lifetime.
  Membership *is* now re-checked (above), so a revoked user is closed out; an
  expired-but-still-a-member token is not. Closing the socket on token expiry
  would need a re-auth frame the frontend does not implement.
- **Revocation window on sockets is up to 60 seconds** by construction — the
  alternative is a database query in front of every keystroke.
- **`SameSite=Lax`** on the refresh cookie is correct while the SPA and API
  share a registrable domain. A genuinely cross-site deployment needs
  `SameSite=None`, which browsers honour only with `Secure` (forced on in
  production). Documented in `.env.example`.
- **Prompt injection is mitigated, not solved.** Documents are delimited and
  the system prompt instructs the model to treat them as content. The real
  defence is that nothing the assistant returns is written or executed without
  a person confirming it.

---

## 9. Verification

Everything below was run on this machine at the end of the audit.

| Command | Result |
| --- | --- |
| `pytest` | **644 passed** |
| `python manage.py check --deploy` (production settings) | **no issues (0 silenced)** |
| `python manage.py makemigrations --check` | **no changes detected** |
| `python manage.py migrate --check` | **exit 0 — nothing unapplied** |
| `ruff check .` | **all checks passed** |
| `ruff format --check .` | **169 files formatted** |
| `manage.py spectacular --validate` | **schema valid** — 35 paths, 50 operations |

Test coverage by area: accounts 76, documents 102, ai 72, notifications 50,
comments 47, tasks 47, projects 39, activity 38, collaboration 33, core 9,
workspaces + cross-cutting 131.

**One caveat, stated because it is the kind of thing an audit exists to
surface:** during this audit a single full-suite run reported 4 failures and 1
error in the registration password-validator tests, in a way consistent with
those requests being throttled or erroring rather than validated. Six
subsequent full-suite runs were clean (644 passed each time) and the failure
could not be reproduced. The root cause is therefore **not** established. Treat
the suite as reliable but not proven deterministic, and re-investigate if it
recurs.

---

## 10. Known limitations

Nothing in this section is a bug; each is a feature that does not exist, and
none is claimed to work.

1. **Not real-time collaborative editing in the CRDT sense.** Server-
   authoritative, last-writer-wins. Concurrent edits to the same paragraph
   clobber. Documented as such everywhere it appears.
2. **`purge_read_notifications` exists but is never scheduled.** There is no
   Celery beat service, so the notifications table grows without bound. One
   `CELERY_BEAT_SCHEDULE` entry plus a beat container closes this; it was left
   out of this audit because it is infrastructure, not a fix.
3. **Docker images were never built or run.** No Docker daemon is available on
   this machine. The Dockerfile, compose file and entrypoint are reviewed and
   internally consistent; they are **unverified**.
4. **The AI integration has never made a real provider call.** Tests inject a
   stub client, which is deliberate — the milestone forbids external calls in
   tests. The request shape, error mapping, timeout, refusal handling and
   truncation handling are all tested against that stub; end-to-end behaviour
   against the live API is unproven.
5. **Redis was never exercised in this environment.** The suite runs on
   in-process substitutes (LocMem cache, in-memory channel layer, eager
   Celery). Cross-worker fan-out, presence across processes and real broker
   behaviour are therefore untested here.
6. **This directory is not a git repository.** No commit history exists to
   audit for leaked secrets.
7. **Missing features:** password reset (`/api/auth/password-reset/` 404s),
   invite-by-email for people without an account, workspace ownership
   transfer, task labels (`/api/labels/` 404s), document sharing endpoints
   (which is why nothing emits `document_shared` notifications).
8. **No load testing, no APM, no error tracking** (Sentry or equivalent) is
   wired up.

---

## 11. Recommended next steps

In the order they would actually matter:

1. **Put the code in git** and run a secret scanner over the history before the
   first push.
2. **Build and run the Docker images**, then run the suite inside the
   container. Everything in §7 is unverified until this happens.
3. **Stand up Redis and run the multi-worker paths for real** — two API
   processes, one document, two browsers. That is the only way to know the
   channel layer and presence work as designed.
4. **Make one live AI call per operation** against a real key in a staging
   environment, and confirm the four responses parse. Budget for the first
   call being slower: structured-output schemas compile once.
5. **Add error tracking and request tracing.** The request-id middleware is
   already in place and every log line carries the correlation id; wiring it to
   an aggregator is the remaining step.
6. **Schedule `purge_read_notifications`** (beat + one schedule entry).
7. **Fill the feature gaps in §10.7**, starting with password reset — it is the
   one users notice immediately.
8. **Re-investigate the flaky run in §9** if it recurs; leave the observation
   in place until it is explained.
9. **Load-test the AI endpoints** before enabling them for a real team; they
   are the only requests that cost money per call.
