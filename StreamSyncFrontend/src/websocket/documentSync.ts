import { createDocumentSocket, type SocketHandle } from '@/websocket/client'
import { outbound } from '@/websocket/events'
import {
  applyCursor,
  applyJoin,
  applyLeave,
  applyPresenceSnapshot,
  decayPresence,
  emptyPresence,
  markEditing,
  type ParticipantMap,
} from '@/websocket/presence'
import {
  ConnectionState,
  DisconnectReason,
  DocumentEvent,
  SyncState,
  type CursorPosition,
  type InboundMessage,
  type Transport,
  type TransportHandlers,
} from '@/websocket/types'
import type { DocumentCollaborator } from '@/types/document'

/**
 * Document session — the layer the editor actually talks to. (CLAUDE.md §56)
 *
 * Composes the socket, presence bookkeeping and save state into one observable
 * object. The editor never imports `client` or `events`; it subscribes here and
 * renders whatever this reports. That is the boundary §54 and Rule 8 ask for,
 * and the reason swapping the synchronisation strategy later touches this file
 * and nothing in components/editor.
 *
 * WHAT THIS IS, PRECISELY
 *
 * Server-authoritative last-write-wins, exactly as §82 prescribes for the first
 * implementation. It is **not** OT and **not** a CRDT, and it is worth being
 * blunt about the consequence: if two people edit the same paragraph within one
 * debounce window, the later write wins and the earlier one is lost. The
 * architecture is arranged so that a real algorithm slots in behind this
 * interface — `pushContent` and the `document.update` handler are the only two
 * places that would change — but nothing here pretends to merge. (§56, §82)
 */

/** How long typing settles before an edit is sent. */
const CONTENT_DEBOUNCE_MS = 600

/** Cursor frames are cheap but not free; one per this interval is plenty. */
const CURSOR_THROTTLE_MS = 120

/** How often stale presence is decayed. */
const PRESENCE_TICK_MS = 2_000

export interface DocumentSessionState {
  connection: ConnectionState
  sync: SyncState
  participants: ParticipantMap
  /** Latest content the *server* has confirmed. Null until the first sync. */
  serverContent: string | null
  revision: number
  lastSavedAt: string | null
  /** Set when the server rejects something; surfaced as the Error save state. */
  error: string | null
  /** True once a remote edit has arrived that the editor has not applied. */
  hasRemoteUpdate: boolean
  /** Why the connection last dropped, when it has. Drives the auth-expired copy. */
  disconnectReason: DisconnectReason | null
}

export interface DocumentSessionOptions {
  documentId: string
  self: DocumentCollaborator
  /** Initial content from the REST fetch, so the editor renders before the socket opens. */
  initialContent: string
  initialRevision: number
  createTransport?: (handlers: TransportHandlers) => Transport
  onChange: (state: DocumentSessionState) => void
  /** Fired when a *remote* edit arrives, so the editor can replace its document. */
  onRemoteContent?: (content: string, revision: number) => void
}

export interface DocumentSession {
  getState: () => DocumentSessionState
  /** Local edit. Debounced, then sent. */
  pushContent: (content: string) => void
  /** Local caret/selection. Throttled, then sent. */
  pushCursor: (cursor: CursorPosition) => void
  /** Flushes any pending edit immediately — used on unmount and on blur. */
  flush: () => void
  destroy: () => void
}

export function createDocumentSession({
  documentId,
  self,
  initialContent,
  initialRevision,
  createTransport,
  onChange,
  onRemoteContent,
}: DocumentSessionOptions): DocumentSession {
  let state: DocumentSessionState = {
    connection: ConnectionState.Connecting,
    sync: SyncState.Synced,
    participants: emptyPresence(),
    serverContent: initialContent,
    revision: initialRevision,
    lastSavedAt: null,
    error: null,
    hasRemoteUpdate: false,
    disconnectReason: null,
  }

  let pendingContent: string | null = null
  let contentTimer: ReturnType<typeof setTimeout> | undefined
  let cursorTimer: ReturnType<typeof setTimeout> | undefined
  let lastCursorSentAt = 0
  let presenceTimer: ReturnType<typeof setInterval> | undefined
  let socket: SocketHandle | null = null
  let disposed = false

  function update(patch: Partial<DocumentSessionState>): void {
    state = { ...state, ...patch }
    if (!disposed) onChange(state)
  }

  /**
   * Save state is derived from the connection plus whether anything is pending,
   * rather than being set at each call site. Keeping it in one function is what
   * stops the badge showing "Saved" while the socket is down. (§37, §69)
   */
  function recomputeSync(): void {
    if (state.error !== null) {
      update({ sync: SyncState.Error })
      return
    }
    if (state.connection !== ConnectionState.Connected) {
      update({ sync: SyncState.Offline })
      return
    }
    if (pendingContent !== null) {
      update({ sync: SyncState.Saving })
      return
    }
    update({ sync: SyncState.Synced })
  }

  function sendPending(): void {
    if (pendingContent === null || !socket) return
    socket.send(outbound.update(documentId, pendingContent, state.revision))
    pendingContent = null
    update({ sync: SyncState.Saving })
  }

  function handleMessage(message: InboundMessage): void {
    // Pongs are consumed by the client; anything reaching here is document
    // traffic, and a frame for a different document is not ours to apply.
    if (!('documentId' in message) || message.documentId !== documentId) return

    switch (message.type) {
      case DocumentEvent.Join:
        // Additive, so an arrival does not disturb anyone else's caret.
        update({ participants: applyJoin(state.participants, message.participant) })
        break

      case DocumentEvent.Leave:
        update({ participants: applyLeave(state.participants, message.userId) })
        break

      case DocumentEvent.Sync:
        update({
          serverContent: message.content,
          revision: message.revision,
          error: null,
        })
        recomputeSync()
        break

      case DocumentEvent.Update:
        // Our own edits echo back; applying them would fight the caret.
        if (message.actorId === self.id) {
          update({ revision: message.revision })
          break
        }
        update({
          serverContent: message.content,
          revision: message.revision,
          participants: markEditing(state.participants, message.actorId),
          hasRemoteUpdate: true,
        })
        onRemoteContent?.(message.content, message.revision)
        break

      case DocumentEvent.Presence:
        update({ participants: applyPresenceSnapshot(message.participants) })
        break

      case DocumentEvent.Cursor:
        if (message.userId === self.id) break
        update({ participants: applyCursor(state.participants, message.userId, message.cursor) })
        break

      case DocumentEvent.Saved:
        update({ revision: message.revision, lastSavedAt: message.savedAt, error: null })
        recomputeSync()
        break

      case DocumentEvent.Error:
        update({ error: message.message })
        recomputeSync()
        break

      default:
        break
    }
  }

  socket = createDocumentSocket({
    documentId,
    ...(createTransport ? { createTransport } : {}),
    onMessage: handleMessage,
    onStateChange: (connection, reason) => {
      update({ connection, ...(reason !== undefined ? { disconnectReason: reason } : {}) })
      recomputeSync()

      if (connection === ConnectionState.Connected) {
        // Anything typed while offline goes out as soon as the link is back.
        sendPending()
      } else if (connection === ConnectionState.Error || connection === ConnectionState.Disconnected) {
        // Presence is only meaningful while connected. Clearing it stops a
        // dropped socket leaving ghost collaborators and stale carets on
        // screen — the most common "is this thing live?" tell. (§57, §69)
        update({ participants: emptyPresence() })
      }
    },
  })

  presenceTimer = setInterval(() => {
    const decayed = decayPresence(state.participants)
    if (decayed !== state.participants) update({ participants: decayed })
  }, PRESENCE_TICK_MS)

  return {
    getState: () => state,

    pushContent(content) {
      pendingContent = content
      update({ sync: SyncState.Saving, hasRemoteUpdate: false })

      if (contentTimer !== undefined) clearTimeout(contentTimer)
      contentTimer = setTimeout(sendPending, CONTENT_DEBOUNCE_MS)
    },

    pushCursor(cursor) {
      const now = Date.now()
      const elapsed = now - lastCursorSentAt

      // Leading-edge throttle with a trailing send, so the *final* resting
      // position always arrives — a purely leading throttle leaves everyone
      // else's view of your caret one move behind.
      if (elapsed >= CURSOR_THROTTLE_MS) {
        lastCursorSentAt = now
        socket?.send(outbound.cursor(documentId, cursor))
        return
      }

      if (cursorTimer !== undefined) clearTimeout(cursorTimer)
      cursorTimer = setTimeout(() => {
        lastCursorSentAt = Date.now()
        socket?.send(outbound.cursor(documentId, cursor))
      }, CURSOR_THROTTLE_MS - elapsed)
    },

    flush() {
      if (contentTimer !== undefined) clearTimeout(contentTimer)
      sendPending()
    },

    destroy() {
      // Flush before tearing down: closing the tab mid-debounce should not
      // discard the last thing typed.
      if (contentTimer !== undefined) clearTimeout(contentTimer)
      if (cursorTimer !== undefined) clearTimeout(cursorTimer)
      if (presenceTimer !== undefined) clearInterval(presenceTimer)
      sendPending()

      socket?.send(outbound.leave(documentId))
      socket?.close()
      socket = null
      disposed = true
    },
  }
}
