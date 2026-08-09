import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocumentSocket } from '@/websocket/client'
import {
  ConnectionState,
  DisconnectReason,
  DocumentEvent,
  SystemEvent,
  type InboundMessage,
  type OutboundMessage,
  type Transport,
  type TransportHandlers,
} from '@/websocket/types'

/**
 * Connection state machine. (CLAUDE.md §54, §57)
 *
 * Driven through a fake transport, so every branch — including the ones a real
 * network only produces occasionally — is reachable deterministically. These
 * are the behaviours that are invisible until they are wrong: a queue that
 * drops typing, a retry loop that hammers a server that already said no, a
 * half-open socket that never recovers.
 */

/** A transport whose lifecycle the test drives by hand. */
function createFakeTransport() {
  const sent: OutboundMessage[] = []
  let handlers: TransportHandlers | null = null
  let closed = false

  let createCount = 0

  const factory = (incoming: TransportHandlers): Transport => {
    handlers = incoming
    closed = false
    createCount += 1
    return {
      send: (message) => sent.push(message),
      close: () => {
        closed = true
      },
    }
  }

  return {
    factory,
    sent,
    get closed() {
      return closed
    },
    /** How many sockets have been opened — one per connect attempt. */
    get createCount() {
      return createCount
    },
    open: () => handlers?.onOpen(),
    receive: (message: InboundMessage) => handlers?.onMessage(message),
    drop: (reason: DisconnectReason = DisconnectReason.Network) =>
      handlers?.onClose({ wasClean: false, reason }),
    closeCleanly: () => handlers?.onClose({ wasClean: true, reason: DisconnectReason.Clean }),
    fail: () => handlers?.onError(new Error('socket error')),
  }
}

let states: ConnectionState[] = []
const record = (state: ConnectionState) => states.push(state)

beforeEach(() => {
  vi.useFakeTimers()
  states = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('connection lifecycle', () => {
  it('reaches CONNECTED and joins the document', () => {
    const transport = createFakeTransport()

    createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    expect(states).toEqual([])
    transport.open()

    expect(states).toEqual([ConnectionState.Connected])
    expect(transport.sent).toContainEqual({ type: DocumentEvent.Join, documentId: 'doc-1' })
  })

  it('goes DISCONNECTED on a clean close, without retrying', () => {
    const transport = createFakeTransport()
    createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    transport.open()
    transport.closeCleanly()

    expect(states.at(-1)).toBe(ConnectionState.Disconnected)

    // A clean goodbye is not a failure; nothing should be scheduled.
    vi.advanceTimersByTime(60_000)
    expect(states).not.toContain(ConnectionState.Reconnecting)
  })

  it('goes RECONNECTING then CONNECTED after an unclean drop', () => {
    const transport = createFakeTransport()
    createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    transport.open()
    transport.drop()
    expect(states.at(-1)).toBe(ConnectionState.Reconnecting)

    // Backoff is jittered, so advance past the first window's ceiling.
    vi.advanceTimersByTime(5_000)
    transport.open()

    expect(states.at(-1)).toBe(ConnectionState.Connected)
  })

  it('re-joins on every reconnect, not only the first connect', () => {
    const transport = createFakeTransport()
    createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    transport.open()
    transport.drop()
    vi.advanceTimersByTime(5_000)
    transport.open()

    // The server has no memory of a socket that dropped; without a second join
    // the client sits connected but unsubscribed.
    const joins = transport.sent.filter((message) => message.type === DocumentEvent.Join)
    expect(joins.length).toBeGreaterThanOrEqual(2)
  })

  it('reports ERROR on a transport error', () => {
    const transport = createFakeTransport()
    createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    transport.open()
    transport.fail()

    expect(states.at(-1)).toBe(ConnectionState.Error)
  })

  it('gives up with ERROR rather than retrying forever', () => {
    const transport = createFakeTransport()
    createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    transport.open()

    // More drops than `maxReconnectAttempts`, each followed by the full window.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      transport.drop()
      vi.advanceTimersByTime(60_000)
    }

    // Silently giving up would leave the UI on "Reconnecting…" forever.
    expect(states.at(-1)).toBe(ConnectionState.Error)
  })
})

describe('authentication failures', () => {
  it('stops retrying when the server rejects the credential', () => {
    const transport = createFakeTransport()
    createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    transport.open()
    transport.drop(DisconnectReason.AuthFailed)

    // Straight to ERROR — reconnecting with a refused token only burns the
    // schedule against a server that will keep saying no.
    expect(states.at(-1)).toBe(ConnectionState.Error)
    expect(states).not.toContain(ConnectionState.Reconnecting)

    vi.advanceTimersByTime(120_000)
    expect(states.at(-1)).toBe(ConnectionState.Error)
  })

  it('passes the reason to the state callback', () => {
    const transport = createFakeTransport()
    const reasons: (DisconnectReason | undefined)[] = []

    createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: (_state, reason) => reasons.push(reason),
    })

    transport.open()
    transport.drop(DisconnectReason.AuthFailed)

    expect(reasons).toContain(DisconnectReason.AuthFailed)
  })
})

describe('offline queueing', () => {
  it('holds frames sent before the socket opens, then flushes them', () => {
    const transport = createFakeTransport()
    const socket = createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    socket.send({ type: DocumentEvent.Update, documentId: 'doc-1', content: '<p>a</p>', baseRevision: 1 })
    expect(transport.sent).toHaveLength(0)

    transport.open()

    // Queued rather than dropped: this is the difference between a
    // "Reconnecting…" badge and lost typing.
    expect(transport.sent).toContainEqual({
      type: DocumentEvent.Update,
      documentId: 'doc-1',
      content: '<p>a</p>',
      baseRevision: 1,
    })
  })

  it('queues while reconnecting and flushes on the next open', () => {
    const transport = createFakeTransport()
    const socket = createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    transport.open()
    transport.drop()

    socket.send({ type: DocumentEvent.Update, documentId: 'doc-1', content: '<p>offline</p>', baseRevision: 2 })

    vi.advanceTimersByTime(5_000)
    transport.open()

    expect(transport.sent.some((m) => m.type === DocumentEvent.Update && m.content === '<p>offline</p>')).toBe(true)
  })

  it('caps the queue so a long outage cannot grow without bound', () => {
    const transport = createFakeTransport()
    const socket = createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    for (let index = 0; index < 250; index += 1) {
      socket.send({ type: DocumentEvent.Cursor, documentId: 'doc-1', cursor: { anchor: index, head: index } })
    }

    transport.open()

    // Bounded, and the *newest* frames are the ones kept.
    const cursors = transport.sent.filter((message) => message.type === DocumentEvent.Cursor)
    expect(cursors.length).toBeLessThanOrEqual(100)
    expect(cursors.at(-1)).toMatchObject({ cursor: { anchor: 249, head: 249 } })
  })
})

describe('heartbeat', () => {
  it('pings once connected', () => {
    const transport = createFakeTransport()
    createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    transport.open()
    vi.advanceTimersByTime(26_000)

    expect(transport.sent.some((message) => message.type === SystemEvent.Ping)).toBe(true)
  })

  it('treats an unanswered ping as a dead connection and reconnects', () => {
    const transport = createFakeTransport()
    createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    transport.open()
    states.length = 0
    const before = transport.createCount

    // Ping goes out, nothing comes back. A half-open socket looks perfectly
    // healthy to the browser, so this is the only thing that detects it.
    vi.advanceTimersByTime(26_000)
    vi.advanceTimersByTime(11_000)

    expect(states).toContain(ConnectionState.Reconnecting)
    // The dead socket was torn down and a fresh one opened. Asserting on the
    // fake's `closed` flag would not work — reconnecting replaces the
    // transport, which resets it.
    expect(transport.createCount).toBeGreaterThan(before)
  })

  it('stays connected while pongs come back', () => {
    const transport = createFakeTransport()
    createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    transport.open()
    states.length = 0

    /* Step just past each ping, answer it, then advance a hair. Jumping a full
       heartbeat interval in one go would sail past the *next* ping's timeout
       window before its pong could be delivered — which is a bug in the test,
       not in the client. */
    for (let beat = 0; beat < 3; beat += 1) {
      vi.advanceTimersByTime(25_100)
      transport.receive({ type: SystemEvent.Pong, sentAt: Date.now() })
      vi.advanceTimersByTime(100)
    }

    expect(states).not.toContain(ConnectionState.Reconnecting)
  })

  it('never forwards a pong to the application', () => {
    const transport = createFakeTransport()
    const received: InboundMessage[] = []

    createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: (message) => received.push(message),
      onStateChange: record,
    })

    transport.open()
    transport.receive({ type: SystemEvent.Pong, sentAt: 1 })
    transport.receive({ type: DocumentEvent.Saved, documentId: 'doc-1', revision: 2, savedAt: 'now' })

    // Liveness is the client's business; nothing above should have to ignore it.
    expect(received).toHaveLength(1)
    expect(received[0]?.type).toBe(DocumentEvent.Saved)
  })
})

describe('cleanup', () => {
  it('closes the transport and stops all timers', () => {
    const transport = createFakeTransport()
    const socket = createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    transport.open()
    socket.close()

    expect(transport.closed).toBe(true)
    expect(socket.getState()).toBe(ConnectionState.Disconnected)

    const countAfterClose = transport.sent.length
    vi.advanceTimersByTime(120_000)

    // No stray heartbeats, no reconnect attempts after teardown.
    expect(transport.sent).toHaveLength(countAfterClose)
  })

  it('ignores messages that arrive after close', () => {
    const transport = createFakeTransport()
    const received: InboundMessage[] = []

    const socket = createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: (message) => received.push(message),
      onStateChange: record,
    })

    transport.open()
    socket.close()
    transport.receive({ type: DocumentEvent.Saved, documentId: 'doc-1', revision: 9, savedAt: 'now' })

    // A frame in flight when the user navigates away must not reach a
    // component that has already unmounted.
    expect(received).toHaveLength(0)
  })

  it('does not reconnect after an intentional close', () => {
    const transport = createFakeTransport()
    const socket = createDocumentSocket({
      documentId: 'doc-1',
      createTransport: transport.factory,
      onMessage: () => undefined,
      onStateChange: record,
    })

    transport.open()
    socket.close()
    states.length = 0

    transport.drop()
    vi.advanceTimersByTime(60_000)

    expect(states).not.toContain(ConnectionState.Reconnecting)
  })
})
