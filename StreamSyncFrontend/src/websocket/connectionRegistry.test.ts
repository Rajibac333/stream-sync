import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  acquireDocumentSession,
  destroyAllSessions,
  getRefCount,
  hasActiveSession,
} from '@/websocket/connectionRegistry'
import type { DocumentSessionState } from '@/websocket/documentSync'
import {
  DisconnectReason,
  DocumentEvent,
  type OutboundMessage,
  type Transport,
  type TransportHandlers,
} from '@/websocket/types'

/**
 * One connection per document. (CLAUDE.md §54)
 *
 * The brief is explicit: "Do not duplicate WebSocket connections. A document
 * should have one controlled collaboration connection." Without the registry,
 * React alone breaks that — StrictMode double-invokes effects, and any second
 * consumer of session state opens its own socket.
 */

interface Harness {
  factory: (handlers: TransportHandlers) => Transport
  opened: number
  closed: number
  sent: OutboundMessage[]
  openAll: () => void
}

function createHarness(): Harness {
  const all: TransportHandlers[] = []
  const sent: OutboundMessage[] = []
  let opened = 0
  let closed = 0

  return {
    factory: (handlers) => {
      opened += 1
      all.push(handlers)
      return {
        send: (message) => sent.push(message),
        close: () => {
          closed += 1
          handlers.onClose({ wasClean: true, reason: DisconnectReason.Clean })
        },
      }
    },
    get opened() {
      return opened
    },
    get closed() {
      return closed
    },
    sent,
    openAll: () => {
      for (const handlers of all) handlers.onOpen()
    },
  }
}

function baseOptions(harness: Harness, documentId = 'doc-1') {
  return {
    documentId,
    self: { id: 'usr-me', name: 'Me', avatarUrl: null },
    initialContent: '<p>hello</p>',
    initialRevision: 1,
    createTransport: harness.factory,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  destroyAllSessions()
  vi.useRealTimers()
})

describe('deduplication', () => {
  it('opens one socket no matter how many callers acquire it', () => {
    const harness = createHarness()
    const noop = (_state: DocumentSessionState) => undefined

    const first = acquireDocumentSession({ ...baseOptions(harness), onChange: noop })
    const second = acquireDocumentSession({ ...baseOptions(harness), onChange: noop })
    const third = acquireDocumentSession({ ...baseOptions(harness), onChange: noop })

    expect(harness.opened).toBe(1)
    expect(getRefCount('doc-1')).toBe(3)
    // All three hold the identical session, not copies of one.
    expect(second.session).toBe(first.session)
    expect(third.session).toBe(first.session)
  })

  it('joins the document once, not once per caller', () => {
    const harness = createHarness()
    const noop = (_state: DocumentSessionState) => undefined

    acquireDocumentSession({ ...baseOptions(harness), onChange: noop })
    acquireDocumentSession({ ...baseOptions(harness), onChange: noop })
    harness.openAll()

    // Two joins would put the same person in the roster twice.
    const joins = harness.sent.filter((message) => message.type === DocumentEvent.Join)
    expect(joins).toHaveLength(1)
  })

  it('keeps separate documents on separate connections', () => {
    const harness = createHarness()
    const noop = (_state: DocumentSessionState) => undefined

    acquireDocumentSession({ ...baseOptions(harness, 'doc-1'), onChange: noop })
    acquireDocumentSession({ ...baseOptions(harness, 'doc-2'), onChange: noop })

    expect(harness.opened).toBe(2)
    expect(getRefCount('doc-1')).toBe(1)
    expect(getRefCount('doc-2')).toBe(1)
  })
})

describe('fan-out', () => {
  it('notifies every subscriber, not just the first', () => {
    const harness = createHarness()
    const first: DocumentSessionState[] = []
    const second: DocumentSessionState[] = []

    acquireDocumentSession({ ...baseOptions(harness), onChange: (s) => first.push(s) })
    acquireDocumentSession({ ...baseOptions(harness), onChange: (s) => second.push(s) })

    first.length = 0
    second.length = 0
    harness.openAll()

    // The session takes one callback; the registry is what makes it many.
    expect(first.length).toBeGreaterThan(0)
    expect(second.length).toBeGreaterThan(0)
  })

  it('gives a late subscriber the current state immediately', () => {
    const harness = createHarness()
    const noop = (_state: DocumentSessionState) => undefined

    acquireDocumentSession({ ...baseOptions(harness), onChange: noop })
    harness.openAll()

    const late: DocumentSessionState[] = []
    acquireDocumentSession({ ...baseOptions(harness), onChange: (s) => late.push(s) })

    // Otherwise a second consumer renders "Connecting…" against an
    // already-connected socket until the next frame happens to arrive.
    expect(late).toHaveLength(1)
    expect(late[0]?.connection).toBe('CONNECTED')
  })

  it('stops notifying a released subscriber', () => {
    const harness = createHarness()
    const dropped: DocumentSessionState[] = []
    const kept: DocumentSessionState[] = []

    const first = acquireDocumentSession({
      ...baseOptions(harness),
      onChange: (s) => dropped.push(s),
    })
    acquireDocumentSession({ ...baseOptions(harness), onChange: (s) => kept.push(s) })

    first.release()
    dropped.length = 0
    kept.length = 0
    harness.openAll()

    expect(dropped).toHaveLength(0)
    expect(kept.length).toBeGreaterThan(0)
  })
})

describe('cleanup', () => {
  it('keeps the socket open while anyone still holds it', () => {
    const harness = createHarness()
    const noop = (_state: DocumentSessionState) => undefined

    const first = acquireDocumentSession({ ...baseOptions(harness), onChange: noop })
    acquireDocumentSession({ ...baseOptions(harness), onChange: noop })

    first.release()

    // This is the StrictMode case: the first effect's cleanup must not close a
    // socket the second effect is still using.
    expect(harness.closed).toBe(0)
    expect(hasActiveSession('doc-1')).toBe(true)
  })

  it('closes the socket when the last holder releases', () => {
    const harness = createHarness()
    const noop = (_state: DocumentSessionState) => undefined

    const first = acquireDocumentSession({ ...baseOptions(harness), onChange: noop })
    const second = acquireDocumentSession({ ...baseOptions(harness), onChange: noop })
    harness.openAll()

    first.release()
    second.release()

    expect(harness.closed).toBe(1)
    expect(hasActiveSession('doc-1')).toBe(false)
  })

  it('leaves the document before closing', () => {
    const harness = createHarness()
    const noop = (_state: DocumentSessionState) => undefined

    const lease = acquireDocumentSession({ ...baseOptions(harness), onChange: noop })
    harness.openAll()
    harness.sent.length = 0

    lease.release()

    // Navigating away must tell the server, or everyone else keeps seeing a
    // ghost participant until the socket times out.
    expect(harness.sent.some((message) => message.type === DocumentEvent.Leave)).toBe(true)
  })

  it('tolerates a double release', () => {
    const harness = createHarness()
    const noop = (_state: DocumentSessionState) => undefined

    const lease = acquireDocumentSession({ ...baseOptions(harness), onChange: noop })
    lease.release()
    lease.release()

    // React can run a cleanup twice under some unmount orders; that must not
    // drive the count negative and tear down a session someone else acquired.
    expect(getRefCount('doc-1')).toBe(0)
    expect(harness.closed).toBe(1)
  })

  it('opens a fresh connection after the last release', () => {
    const harness = createHarness()
    const noop = (_state: DocumentSessionState) => undefined

    acquireDocumentSession({ ...baseOptions(harness), onChange: noop }).release()
    acquireDocumentSession({ ...baseOptions(harness), onChange: noop })

    // Navigating away and back is a new connection, not a resurrected one.
    expect(harness.opened).toBe(2)
    expect(hasActiveSession('doc-1')).toBe(true)
  })

  it('destroyAllSessions clears everything', () => {
    const harness = createHarness()
    const noop = (_state: DocumentSessionState) => undefined

    acquireDocumentSession({ ...baseOptions(harness, 'doc-1'), onChange: noop })
    acquireDocumentSession({ ...baseOptions(harness, 'doc-2'), onChange: noop })

    destroyAllSessions()

    // Sign-out has to take every socket with it — sockets authenticated as the
    // previous user must not survive into the next session.
    expect(hasActiveSession('doc-1')).toBe(false)
    expect(hasActiveSession('doc-2')).toBe(false)
    expect(harness.closed).toBe(2)
  })
})
