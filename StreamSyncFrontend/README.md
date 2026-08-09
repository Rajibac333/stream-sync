# StreamSync — Frontend

Real-time collaborative workspace for distributed teams.
See [`../CLAUDE.md`](../CLAUDE.md) for the full engineering specification.

**Status: integrated with Django.** Every route §24 requires is backed by a
real screen — authentication, the application shell, dashboard, workspace
overview, projects, documents, the task board, the collaborative document
editor, the contextual AI assistant, members and settings — and every one of
them reads and writes through the API. There is no mock data set: the backend
must be running. See [`../INTEGRATION.md`](../INTEGRATION.md).

### About the AI responses

The assistant summarises, extracts action items, rewrites a selection and
answers questions **about the open document**, through Django
(`POST /api/ai/summarize/`, `/action-items/`, `/improve/`, `/ask/`). The
provider key lives there and never in this package.

Every result says which engine produced it. With no provider key configured the
backend answers with a deterministic reader that parses the real document and
quotes it — useful, and **not a language model**, which is what the panel says.
Nothing is fabricated either way: each action item carries the sentence it came
from, and a question the document does not answer gets "this document doesn't
cover that" rather than a guess.

## Getting started

```bash
# 1. The API, in another terminal (see ../StreamSyncBackend/SETUP.md)
cd ../StreamSyncBackend && python manage.py runserver 8000

# 2. This app
npm install
cp .env.example .env.local
npm run dev
```

Create an account from the register screen. A new account belongs to no
workspace yet, and the dashboard says so with a **Create workspace** action —
that is the real first-run path, not a special case.

Open <http://localhost:5173/design-system> — the living reference for every
token and primitive, in both themes.

## Commands

| Command              | What it does                                        |
| -------------------- | --------------------------------------------------- |
| `npm run dev`        | Dev server with HMR                                 |
| `npm run build`      | Typecheck, then production build                    |
| `npm run typecheck`  | TypeScript across the app, node and e2e projects    |
| `npm run lint`       | oxlint                                              |
| `npm run test`       | Vitest, once                                        |
| `npm run test:watch` | Vitest in watch mode                                |
| `npm run test:e2e`   | Playwright — the §84 demo flow, desktop and 375px   |
| `npm run preview`    | Serve the production build locally                  |

All four gates — lint, typecheck, test, build — must pass before a milestone is
considered complete (§76).

`test:e2e` starts its own dev server. Locally it drives the installed Google
Chrome, because Playwright's bundled Chromium does not support macOS 13; CI
drops the channel and uses the pinned Chromium, where reproducibility matters
more than matching whatever a developer happens to have installed.

## Architecture

```
src/
├── app/          config, providers, router, query client
├── api/          HTTP client, token custody, query keys, services
├── components/
│   ├── activity/ timeline feed
│   ├── auth/     route guards, auth layout, password fields
│   ├── dashboard/ greeting and figure strip
│   ├── documents/ document rows
│   ├── layout/   shell — sidebar, topbar, drawer, breadcrumbs, sections
│   ├── navigation/  workspace switcher, command menu, user menu
│   ├── notifications/
│   ├── projects/ project cards
│   ├── tasks/    task rows
│   ├── ai/       assistant panel — summary, actions, rewrite, ask
│   ├── comments/ threads, composer, mentions
│   ├── editor/   Tiptap surface, presence, history, sharing
│   ├── workspace/ quick actions, member roster, invitations
│   └── ui/       design-system primitives
├── hooks/        session, workspaces, search, notifications, a11y utilities
├── pages/        every route in §24
├── websocket/    typed client, presence, document sync
├── schemas/      Zod form schemas
├── store/        Zustand — UI state only
├── styles/       design tokens + base layer
├── test/         Vitest setup + render helpers
├── types/        shared contracts
├── utils/        pure helpers
└── constants/    routes, navigation
```

### Rules this codebase enforces

**Data flows one way.** `component → hook → API service → client → axios`.
Nothing outside `src/api` imports axios, and no component contains a raw HTTP
call (§51, Rule 7).

**TanStack Query owns server state. Zustand owns UI state.** They never mirror
each other — a duplicated cache is a cache that drifts. The signed-in user is
server state and lives under `queryKeys.auth.session`, not in a store (§52,
§53).

**Tokens are the only source of colour.** Components consume semantic tokens
(`bg-surface`, `text-foreground-muted`); the raw palette is private to
`styles/tokens.css`. Theming is an attribute swap on `<html>`, so there is no
`dark:` variant scattered through the JSX (§12, §17).

**Accessibility is built into the primitives.** Focus trapping, escape handling,
label/error wiring and ARIA live where the component is defined, not at each
call site — that is what makes it hold as the app grows (§19).

**Route protection is UX, not security.** `RequireAuth` decides what to render.
It does not decide what a user may do — every authorisation decision that
matters belongs to Django (§26).

**No secrets in this package.** Everything `VITE_`-prefixed ships to the
browser. AI provider keys live behind Django: `React → Django → AI provider`
(§9, §50, §66).

## Authentication

`src/api/auth.ts` is the only seam between the app and how authentication
happens.

| Concern         | How it works                                        |
| --------------- | --------------------------------------------------- |
| Access token    | JWT, held in memory only                             |
| Refresh token   | httpOnly cookie, unreadable to JavaScript            |
| Passwords       | Django's hasher, server-side                         |
| Session restore | `POST /auth/refresh/` on boot                        |

The access token is deliberately **never** in `localStorage` — see the reasoning
in `src/api/tokenStorage.ts`.

## Keyboard

| Keys       | Action                          |
| ---------- | ------------------------------- |
| `⌘/Ctrl K` | Command menu                    |
| `⌘/Ctrl B` | Collapse / expand the sidebar   |
| `Esc`      | Close the open overlay          |
| `↑ ↓ ↵`    | Move and select in the menu     |

The same list is in the app under **Help** in the sidebar, and it only lists
shortcuts that actually work.

## Theming

`data-theme` on `<html>` is resolved by a blocking inline script in
`index.html` before first paint, so dark-mode users never see a white flash.
The storage key (`streamsync-theme`) is shared with `store/themeStore.ts` —
change one and you must change the other.

## Testing

282 unit and component tests across 20 files (`npm run test`), plus 16
end-to-end tests (`npm run test:e2e`). Unit tests live beside the code they
cover (`LoginPage.test.tsx` next to `LoginPage.tsx`); the browser specs live in
[`e2e/`](e2e) and query by role and accessible name, so a failure there means a
screen-reader user's experience broke first.

| Area                      | What is covered                                              |
| ------------------------- | ------------------------------------------------------------ |
| `schemas/auth`            | password policy, email normalisation, mismatch targeting      |
| `utils/redirect`          | open-redirect rejection, deep-link return                     |
| `constants/navigation`    | exactly one active section per route                          |
| `pages/auth/LoginPage`    | validation, loading, server errors, field-scoped errors        |
| `components/auth/routeGuards` | protection, boot state, deep-link carry-through           |
| `components/navigation/CommandMenu` | combobox ARIA, arrow/Home/End/Enter, grouping      |
| `hooks/useWorkspaceContent` | dashboard selectors — which slice of a list each section shows |
| `components/ai/AIAssistantPanel` | empty, loading, result and refusal states, and that extraction creates nothing on its own |
| `websocket/presence`      | presence decay, join/leave, cursor routing, avatar ordering |
| `websocket/events`        | inbound frame validation — malformed frames dropped, not cast |
| `websocket/client`        | all five connection states, backoff, auth refusal, queueing, ping/pong, cleanup |
| `websocket/connectionRegistry` | one socket per document, ref-counting, fan-out, teardown |
| `utils/url`               | link protocol allow-list (`javascript:`, `data:` rejected) |

Component tests query by **role** (`combobox`, `option`, `listbox`, `alert`),
so they fail if the accessibility semantics regress and not merely if the
markup moves. Services are stubbed at the module boundary (`vi.mock('@/api/…')`)
rather than over HTTP: these are tests of what a component does with an answer,
and the answers themselves are covered by the backend suite and the end-to-end
specs.

Everything above the unit level runs against the real API — see
[`../INTEGRATION.md`](../INTEGRATION.md).

## Real-time layer

`src/websocket/` is the whole protocol surface, and nothing outside it knows a
socket exists — the editor subscribes to `useDocumentSession` and renders React
state. (§54, Rule 8)

| Module               | Owns                                                                |
| -------------------- | ------------------------------------------------------------------- |
| `types`              | connection states, presence, the §81 event union, disconnect reasons |
| `events`             | frame construction, and validation of everything inbound            |
| `client`             | connect, auth, reconnect with jittered backoff, ping/pong, queueing |
| `presence`           | pure reducers — who joined, left, is editing, whose caret is where  |
| `documentSync`       | composes the above into one observable session                      |
| `connectionRegistry` | **one socket per document**, ref-counted across callers             |

**One connection per document.** `createDocumentSession` opens a socket per
call, which is wrong for React — StrictMode double-invokes effects, and any
second consumer of session state would open its own. The registry makes the
connection a ref-counted resource: acquire by document id, release when done,
created on the first acquire and destroyed on the last.

**Authentication** rides in `Sec-WebSocket-Protocol`, not a query string: the
browser WebSocket API cannot set headers, and `?token=` puts credentials into
access logs, browser history and `Referer`. Django Channels must echo a
subprotocol back in `accept()` or the handshake fails — that is the one backend
requirement to confirm before integrating.

**Heartbeat is a real ping/pong** with a 10s unanswered-pong timeout. A
half-open TCP connection looks perfectly healthy to the browser — `readyState`
stays OPEN and no close event fires — so an application-level ping is the only
thing that detects it.

**An auth rejection stops the retry loop.** Reconnecting with a credential the
server just refused only burns the backoff schedule; the editor shows "Session
expired — reload to sign in" instead of a "Reconnecting…" that never resolves.

Connection states, backoff, presence decay and save states are exercised in
`websocket/client.test.ts` through an injected fake transport, and end to end by
`e2e/collaboration.spec.ts`, which drives two real browsers against Django
Channels.

**Synchronisation is server-authoritative last-write-wins — not OT, not a
CRDT.** If two people edit the same paragraph inside one debounce window, the
later write wins and the earlier is lost. §82 prescribes exactly this for the
first implementation, and `documentSync.ts` names the two places a real
algorithm would slot in. Nothing here pretends to merge.

## Collaboration layer

Comments are addressed by `(resourceType, resourceId)` rather than by document,
so one service, one hook set and one panel serve both the editor sidebar and the
task dialog. That is what stops the two drifting into different feature sets.

Two side effects are modelled because a real backend performs them in the same
transaction as the write: a comment records an activity entry, and each
@mention raises a notification. A frontend that fakes only the write ends up
with a comment nobody is told about — and a notification badge that never reacts
to anything the user does is what makes a prototype feel fake.

Mentions are stored as structured references next to the body, not re-parsed out
of the text at render time. Parsing "@Raj" back to a user is ambiguous the
moment two people share a first name, and it breaks entirely once someone
changes their display name.

Version restore is a **forward** write — the restored text becomes the newest
version rather than deleting history. Rewriting the past would make the timeline
lie about what happened.

## Bundle

Authenticated screens are code-split on the auth boundary — a signed-out
visitor's first paint is the login form and does not carry the Kanban board or
the drag-and-drop engine with it. Entry chunk is ~534 kB raw / 168 kB gzip
(down from 866 / 266), with each screen its own chunk behind one Suspense
boundary inside the shell, so navigation never blanks the chrome.

Vite still warns about the entry exceeding 500 kB. The warning is left in place
rather than silenced: React, the router, TanStack Query, axios, Zod and Framer
Motion are all genuinely needed to render the login screen, and the next real
cut is a dependency decision rather than a config one.

## Next milestone

Milestone 5 — the collaborative editor: Tiptap, the document toolbar, presence
and cursor UI, comments architecture, version history and sharing.
