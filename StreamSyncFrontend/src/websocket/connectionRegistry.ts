import { createDocumentSession, type DocumentSession, type DocumentSessionOptions } from '@/websocket/documentSync'

/**
 * One collaboration connection per document. (CLAUDE.md §54)
 *
 * WHY THIS EXISTS
 *
 * `createDocumentSession` opens a socket every time it is called. That is
 * correct for the module but wrong for React, which calls things more than
 * once:
 *
 *   • StrictMode double-invokes effects in development, so every mount used to
 *     open two sockets, join twice, and produce a presence roster containing
 *     the same person twice.
 *   • Any second component wanting session state — a presence strip in the
 *     header, a connection badge in the topbar — would open its own.
 *   • A fast back-then-forward navigation could start a new socket before the
 *     old one's teardown had finished.
 *
 * The registry makes the connection a *resource* rather than a side effect:
 * acquire it by document id, release it when done, and the underlying session
 * is created on the first acquire and destroyed on the last release. This is
 * plain reference counting, which is all the problem needs.
 */

interface Entry {
  session: DocumentSession
  /** How many callers currently hold this session. */
  refCount: number
  /** Fan-out to every subscriber, since the session takes a single callback. */
  subscribers: Set<(state: ReturnType<DocumentSession['getState']>) => void>
  remoteSubscribers: Set<(content: string, revision: number) => void>
}

const entries = new Map<string, Entry>()

export interface SessionLease {
  session: DocumentSession
  /** Must be called exactly once. Releasing twice is ignored, not fatal. */
  release: () => void
}

/**
 * Acquires the session for a document, creating it only if nobody holds one.
 *
 * The `onChange` and `onRemoteContent` callbacks belong to *this* caller and
 * are unsubscribed on release; the session itself outlives them for as long as
 * anyone else is still holding it.
 */
export function acquireDocumentSession(
  options: DocumentSessionOptions,
): SessionLease {
  const { documentId, onChange, onRemoteContent } = options
  let entry = entries.get(documentId)

  if (!entry) {
    const subscribers = new Set<(state: ReturnType<DocumentSession['getState']>) => void>()
    const remoteSubscribers = new Set<(content: string, revision: number) => void>()

    const session = createDocumentSession({
      ...options,
      // The session notifies the registry, which fans out. Handing it one
      // caller's callback would silently drop every other subscriber.
      onChange: (state) => {
        for (const subscriber of subscribers) subscriber(state)
      },
      onRemoteContent: (content, revision) => {
        for (const subscriber of remoteSubscribers) subscriber(content, revision)
      },
    })

    entry = { session, refCount: 0, subscribers, remoteSubscribers }
    entries.set(documentId, entry)
  }

  const current = entry
  current.refCount += 1
  current.subscribers.add(onChange)
  if (onRemoteContent) current.remoteSubscribers.add(onRemoteContent)

  // Late subscribers get the current state immediately rather than waiting for
  // the next frame — otherwise a second consumer renders "Connecting…" against
  // an already-connected socket.
  onChange(current.session.getState())

  let released = false

  return {
    session: current.session,
    release() {
      if (released) return
      released = true

      current.subscribers.delete(onChange)
      if (onRemoteContent) current.remoteSubscribers.delete(onRemoteContent)
      current.refCount -= 1

      if (current.refCount <= 0) {
        // Last one out closes the socket. `destroy` flushes any pending edit,
        // sends `document.leave` and clears every timer. (§57)
        current.session.destroy()
        entries.delete(documentId)
      }
    },
  }
}

/** How many callers hold the session for a document. Testing/diagnostics only. */
export function getRefCount(documentId: string): number {
  return entries.get(documentId)?.refCount ?? 0
}

/** True when a live session exists. Testing/diagnostics only. */
export function hasActiveSession(documentId: string): boolean {
  return entries.has(documentId)
}

/**
 * Tears down every session.
 *
 * For tests, and for a full sign-out — sockets authenticated as the previous
 * user must not survive into the next session.
 */
export function destroyAllSessions(): void {
  for (const entry of entries.values()) entry.session.destroy()
  entries.clear()
}
