# StreamSync — Frontend ↔ Backend Integration

How the React app and the Django API are wired together, what was fixed to make
them fit, and how to verify it yourself.

Both halves passed their own test suites long before they had ever spoken to
each other. That is the failure mode this document is about: a mismatch in the
JSON between them is invisible to every test that runs on one side alone.

---

## Running the two together

```bash
# 1. API — http://localhost:8000
cd StreamSyncBackend
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver 8000

# 2. App — http://localhost:5173
cd StreamSyncFrontend
npm run dev
```

**The API is not optional.** There is no mock data set and no offline mode: the
frontend reads and writes everything through Django, and with the backend down
every screen shows its error state. That is the point — a second implementation
of the product living in `src/mocks` was a second thing to keep true, and it
drifted silently while both halves passed their own tests.

**CORS:** the backend's development settings allow ports 5173 (dev), 4173
(preview) and 5273 (the e2e runner). A browser refused by CORS reports a bare
network error, so an unlisted port looks like a backend that is down rather than
one that is running and saying no.

---

## Verifying it

```bash
cd StreamSyncFrontend
npm run test      # 176 unit tests — components and pure logic, services stubbed
npm run test:e2e  # 9 end-to-end specs against Django — needs the API running
```

The end-to-end suite is the one that proves integration. Every spec drives a
real browser against the real API:

| Spec | What it establishes |
| --- | --- |
| `smoke.spec.ts` | A brand-new account can register and reach the app. |
| `auth.spec.ts` | Sign out and back in, a rejected password showing the server's own message, and an anonymous visitor being sent to the login screen. |
| `journey.spec.ts` | The full §84 demo narrative: register → workspace → project → document → edit → version history → AI → comments → task → search → activity → dashboard. Asserts that **no API call returned 4xx/5xx** along the way. |
| `collaboration.spec.ts` | Two browsers, one document: an invitation accepted, presence shown, and an edit by one person appearing for the other **without a refresh**. |
| `responsive.spec.ts` | At 375px: the drawer replaces the sidebar, navigates and closes, and no workspace screen scrolls sideways. |

Each spec registers its own account and builds its own workspace, so the suite
is repeatable against a database that already has data in it. It runs with
`reducedMotion: 'reduce'` — the app honours that (§20), and it removes a real
source of flake where a click races a drawer's opening transition.

---

## What was wrong, and what fixes it

Everything below was found by running the two halves together — most of it
would have shipped silently.

### Contract mismatches (frontend)

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every error read "That request couldn't be processed"; forms never highlighted a field | `normalizeError` parsed DRF's default `{detail}` / `{field: []}`, but the backend returns `{"error": {code, message, details}}` from its own handler | `src/api/client.ts` reads the envelope: the server's sentence becomes the message, `details` becomes `fieldErrors`, and the domain code is carried on a new `serverCode` |
| Version history rendered nothing | Client expected a bare camelCase array; the API paginates and speaks snake_case | `documentsApi.versions` maps `results` through a `toVersion` DTO mapper |
| Tasks created from AI action items had `undefined` everywhere | The confirm endpoint returns ordinary task objects, but the client typed them as already-camelCase | `ai.ts` reuses `toTask` from `tasks.ts` — one mapping, one place to change |
| Share dialog 404'd | No per-document ACL exists in the backend | `documentsApi.shares` now reports the workspace roster, which *is* the access model; changing a role from there refuses with an explanation rather than silently changing it workspace-wide |
| Password reset "worked" but sent nothing | No endpoint; there is no mail pipeline | Rejects with a plain message instead of an opaque 404 |
| Label picker 404'd on every load | No label catalogue exists; tasks always return `labels: []` | Returns an empty catalogue |

### The mock layer, removed

`src/mocks` was ~5,900 lines implementing a second version of the product —
services, fixtures, a seeded database and an in-process WebSocket server — with
a `VITE_API_MODE` switch choosing between them. It is gone, along with the
switch, the `useMock` branch in all ten service modules, the demo-credentials
button on the login screen, and the `actorId` fields that only existed because a
mock has no session to read.

Its 103 unit tests went with it: they asserted that the fiction behaved like the
fiction. What replaced them is thinner and truer — components stub the service
module they call, and everything about real data is asserted against the real
backend.

### Missing endpoints (backend)

| Endpoint | Why it was needed |
| --- | --- |
| `GET /api/search/` | The command menu (⌘K) called it and got a 404. Backend README §47 specifies search over documents, projects and tasks; people are included because the frontend's result union has them. Flat and ranked across types, scoped to the caller's workspaces, capped, ~5 queries regardless of result count. |
| `GET /api/dashboard/` | The dashboard called it and got a 404. The counts **cannot** be computed client-side and be correct: every list is paginated at 25, so a client summing what it holds reports "3 due today" for a workspace with two hundred tasks. |
| `GET /api/workspaces/invitations/` (reshaped) | The endpoint existed but returned membership rows with no workspace name — the recipient could not tell what they had been invited to. Now names the workspace and the inviter. |

**Dashboard collaborator presence is derived from recent activity, not from
live WebSocket sessions.** Live presence is per-document and lives in Redis;
there is no workspace-wide roster to read. The weaker signal is used and
labelled rather than a stronger one that would be wrong.

### First-run gaps (frontend)

These only appeared once the real API was the only source of data. The mock
layer seeded a workspace, so nobody ever met the empty case.

| Gap | Fix |
| --- | --- |
| A new account saw "No workspaces" as dead text, a disabled sidebar, and no way forward | The switcher renders a **Create workspace** button in that state |
| The dashboard sat on skeletons that would never resolve | An empty state with a create action, keeping the `h1` so the page still has a top-level heading |
| An invited teammate could never join: the workspace is deliberately absent from their switcher, and nothing called the invitations endpoint | `usePendingInvitations` + `useAcceptInvitation`, surfaced by `InvitationList` on the dashboard — in the empty state and above the grid |

---

## Wire conventions

- **REST is snake_case; the application is camelCase.** Translation happens in
  `src/api/*.ts` and nowhere else, so no component ever sees `avatar_url`.
- **WebSocket frames are flat camelCase** (`documentId`, `baseRevision`) — a
  deliberate difference from REST, documented in
  `StreamSyncBackend/docs/WEBSOCKET_PROTOCOL.md`.
- **Lists are paginated** (`{count, page, page_size, total_pages, next,
  previous, results}`) except comments, search and AI task confirmation, which
  return bare arrays because their consumers are bounded and never page.
- **The client never names the actor.** No request body carries a user id for
  authorship; the server takes it from the session. A client that can name the
  actor can name somebody else.
- **The access token lives in memory; the refresh token is an httpOnly
  cookie.** The client sends `withCredentials` and never reads it.
- **The WebSocket token rides in `Sec-WebSocket-Protocol`**
  (`streamsync.bearer`, then the token), because a browser cannot set headers on
  a WebSocket and a token in the query string ends up in access logs.

---

## Known limitations

1. **Password reset, invite-by-email for people without an account, per-document
   sharing, and task labels do not exist.** Each is refused with an explanation
   rather than failing opaquely.
2. **The refresh endpoint is throttled per account, not per address.** It fires
   on every page load, so a per-IP budget signed out everyone behind one office
   connection — and the key cannot be the cookie, because tokens rotate on every
   refresh and a rotating key never binds. See `apps/accounts/throttles.py`.
3. **Redis was not running for this verification.** The backend ran with
   `DJANGO_USE_REDIS=False`, so the channel layer and presence roster were
   in-process. Single-worker real-time works — the two-browser spec proves it —
   but cross-worker fan-out is untested here.
4. **The AI provider was the deterministic fallback** (`mock-heuristic`), which
   is what the responses say. No live provider call has been made from the
   integrated stack.
5. **Concurrent edits are last-writer-wins**, not merged. Two people typing in
   the same paragraph at the same instant will clobber one another. This is
   server-authoritative sync, not OT and not a CRDT.
6. **`DJANGO_THROTTLE_REGISTER` is raised in the local `.env`** so the live
   suite can register an account per run. The production default (5/hour per
   IP) is unchanged in `.env.example`.
