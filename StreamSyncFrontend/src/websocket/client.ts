import { tokenStorage } from '@/api/tokenStorage'
import { config } from '@/app/config'
import { outbound, parseInbound } from '@/websocket/events'
import {
  ConnectionState,
  DisconnectReason,
  SystemEvent,
  type InboundMessage,
  type OutboundMessage,
  type Transport,
  type TransportHandlers,
} from '@/websocket/types'

/**
 * Document socket client. (CLAUDE.md §54, §57)
 *
 * Owns everything §54 requires — connect, disconnect, reconnect,
 * authentication, heartbeat, connection state, error handling, exponential
 * backoff and cleanup — and nothing about documents. It moves frames;
 * `documentSync` decides what they mean.
 *
 * Behaviours worth calling out:
 *
 *   Backoff is jittered. Without jitter, every client dropped by one server
 *   restart reconnects on the same schedule and stampedes it a second time.
 *
 *   Frames sent while the socket is down are queued and flushed on reconnect,
 *   which is what turns a dropped connection into a "Reconnecting…" badge
 *   rather than lost typing. (§57, §69)
 *
 *   An auth rejection stops the retry loop. Reconnecting with a credential the
 *   server just refused only burns the schedule; the session layer surfaces it
 *   so the user can sign in again.
 */

export interface SocketOptions {
  documentId: string
  /** Injected by tests with a fake transport; production uses the browser's. */
  createTransport?: (handlers: TransportHandlers) => Transport
  onMessage: (message: InboundMessage) => void
  onStateChange: (state: ConnectionState, reason?: DisconnectReason) => void
}

export interface SocketHandle {
  send: (message: OutboundMessage) => void
  /** Intentional teardown — no reconnect follows. */
  close: () => void
  getState: () => ConnectionState
}

/** Frames buffered while offline. Capped so a long outage cannot grow forever. */
const MAX_QUEUED = 100

/**
 * How long a ping may go unanswered before the connection is treated as dead.
 *
 * This is the whole point of the heartbeat: a half-open TCP connection looks
 * perfectly healthy to the browser — `readyState` is OPEN, no close event ever
 * fires — while the server has long since forgotten it. Nothing detects that
 * except an unanswered application-level ping.
 */
const PONG_TIMEOUT_MS = 10_000

export function createDocumentSocket({
  documentId,
  createTransport,
  onMessage,
  onStateChange,
}: SocketOptions): SocketHandle {
  const { maxReconnectAttempts, baseReconnectDelayMs, maxReconnectDelayMs, heartbeatIntervalMs } =
    config.websocket

  let transport: Transport | null = null
  let state: ConnectionState = ConnectionState.Connecting
  let attempts = 0
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let pongTimer: ReturnType<typeof setTimeout> | undefined
  const queue: OutboundMessage[] = []

  function setState(next: ConnectionState, reason?: DisconnectReason): void {
    if (state === next) return
    state = next
    onStateChange(next, reason)
  }

  function clearTimers(): void {
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
    if (pongTimer !== undefined) clearTimeout(pongTimer)
    reconnectTimer = undefined
    heartbeatTimer = undefined
    pongTimer = undefined
  }

  /**
   * Full jitter: a random point in [0, cappedDelay] rather than the delay
   * itself. Reconnecting clients then spread across the window instead of
   * arriving together.
   */
  function backoffDelay(): number {
    const exponential = Math.min(baseReconnectDelayMs * 2 ** attempts, maxReconnectDelayMs)
    return Math.random() * exponential
  }

  function flushQueue(): void {
    if (!transport) return
    while (queue.length > 0) {
      const message = queue.shift()
      if (message) transport.send(message)
    }
  }

  /** Drops the socket so the normal reconnect path takes over. */
  function treatAsDead(): void {
    if (disposed) return
    transport?.close()
    transport = null
    clearTimers()
    scheduleReconnect()
  }

  function startHeartbeat(): void {
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)

    heartbeatTimer = setInterval(() => {
      if (state !== ConnectionState.Connected || !transport) return

      transport.send(outbound.ping())

      // A pong resets this; silence past the window means the link is gone
      // even though the browser still believes it is open.
      if (pongTimer !== undefined) clearTimeout(pongTimer)
      pongTimer = setTimeout(treatAsDead, PONG_TIMEOUT_MS)
    }, heartbeatIntervalMs)
  }

  function scheduleReconnect(reason: DisconnectReason = DisconnectReason.Network): void {
    if (disposed) return

    // Retrying a refused credential is pointless — the answer will not change.
    if (reason === DisconnectReason.AuthFailed) {
      setState(ConnectionState.Error, reason)
      return
    }

    if (attempts >= maxReconnectAttempts) {
      // Giving up silently would leave the UI claiming "Reconnecting…" forever.
      setState(ConnectionState.Error, reason)
      return
    }

    setState(ConnectionState.Reconnecting, reason)
    const delay = backoffDelay()
    attempts += 1
    reconnectTimer = setTimeout(connect, delay)
  }

  function connect(): void {
    if (disposed) return
    setState(attempts === 0 ? ConnectionState.Connecting : ConnectionState.Reconnecting)

    const handlers: TransportHandlers = {
      onOpen: () => {
        attempts = 0
        setState(ConnectionState.Connected)
        // Re-join on every open, including reconnects: the server has no memory
        // of a socket that dropped, and without this the client would sit in a
        // connected-but-not-subscribed state.
        transport?.send(outbound.join(documentId))
        flushQueue()
        startHeartbeat()
      },

      onMessage: (message) => {
        if (disposed) return

        // Pongs are consumed here — they are liveness, not application data,
        // and nothing above this layer should have to ignore them.
        if (message.type === SystemEvent.Pong) {
          if (pongTimer !== undefined) clearTimeout(pongTimer)
          pongTimer = undefined
          return
        }

        onMessage(message)
      },

      onClose: ({ wasClean, reason }) => {
        if (disposed) return
        clearTimers()
        // A clean close is the server saying goodbye; anything else is a drop
        // worth retrying.
        if (wasClean) setState(ConnectionState.Disconnected, DisconnectReason.Clean)
        else scheduleReconnect(reason)
      },

      onError: () => {
        if (disposed) return
        setState(ConnectionState.Error)
      },
    }

    transport = createTransport
      ? createTransport(handlers)
      : createWebSocketTransport(documentId, handlers)
  }

  connect()

  return {
    send(message) {
      if (disposed) return
      if (state === ConnectionState.Connected && transport) {
        transport.send(message)
        return
      }
      // Offline: keep the most recent edits rather than the oldest.
      queue.push(message)
      if (queue.length > MAX_QUEUED) queue.shift()
    },

    close() {
      disposed = true
      clearTimers()
      transport?.close()
      transport = null
      setState(ConnectionState.Disconnected, DisconnectReason.Clean)
    },

    getState: () => state,
  }
}

/* -----------------------------------------------------------------------------
 * Real transport
 *
 * The browser transport. Deliberately thin — every decision that could be
 * wrong lives above it, in code the test double also drives, so this
 * is deliberately thin — every decision that could be wrong lives above, in
 * code the mock transport also drives.
 * -------------------------------------------------------------------------- */

/** Close codes Django Channels uses for an unauthenticated or forbidden socket. */
const AUTH_CLOSE_CODES = new Set([4001, 4003, 1008])

/**
 * Authenticates the socket.
 *
 * The browser WebSocket API cannot set request headers, so the bearer token
 * cannot travel as `Authorization`. Two options remain, and this picks the
 * safer one:
 *
 *   subprotocol  the token rides in `Sec-WebSocket-Protocol`. Not logged by
 *                proxies or server access logs, and not in the URL.
 *   query string `?token=…` — simple, but URLs end up in access logs, browser
 *                history and `Referer` headers, which is where credentials go
 *                to leak.
 *
 * Django Channels reads `scope["subprotocols"]` and **must echo one back** in
 * its `accept()` call, or the browser fails the handshake. That requirement is
 * on the backend, and is the one thing to confirm before integrating.
 */
function buildProtocols(): string[] | undefined {
  const token = tokenStorage.get()
  return token ? ['streamsync.bearer', token] : undefined
}

function createWebSocketTransport(documentId: string, handlers: TransportHandlers): Transport {
  const url = `${config.websocket.baseUrl}/documents/${documentId}/`
  const protocols = buildProtocols()
  const socket = protocols ? new WebSocket(url, protocols) : new WebSocket(url)

  socket.addEventListener('open', () => handlers.onOpen())
  socket.addEventListener('error', (event) => handlers.onError(event))

  socket.addEventListener('close', (event) => {
    // The close code is the only signal distinguishing "your token is no good"
    // from "the network blinked", and they need opposite responses.
    const reason = AUTH_CLOSE_CODES.has(event.code)
      ? DisconnectReason.AuthFailed
      : event.wasClean
        ? DisconnectReason.Clean
        : DisconnectReason.Network

    handlers.onClose({ wasClean: event.wasClean, reason })
  })

  socket.addEventListener('message', (event) => {
    try {
      const parsed = parseInbound(JSON.parse(String(event.data)))
      // parseInbound returns null for anything unrecognised, which is dropped
      // rather than surfaced — see events.ts for why that is deliberate.
      if (parsed) handlers.onMessage(parsed)
    } catch {
      // Malformed JSON from the wire is not worth tearing the socket down for.
    }
  })

  return {
    send: (message) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    },
    close: () => socket.close(1000, 'client closed'),
  }
}
