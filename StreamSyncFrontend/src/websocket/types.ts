import type { DocumentCollaborator } from '@/types/document'

/**
 * WebSocket contracts. (CLAUDE.md §54, §55, §81)
 *
 * This file is the whole protocol surface. Nothing outside src/websocket needs
 * to know a socket exists — the editor consumes React state, and this layer is
 * what turns frames into that state.
 */

/* -----------------------------------------------------------------------------
 * Connection
 * -------------------------------------------------------------------------- */

/** The five states §54 requires. */
export const ConnectionState = {
  Connecting: 'CONNECTING',
  Connected: 'CONNECTED',
  Disconnected: 'DISCONNECTED',
  Reconnecting: 'RECONNECTING',
  Error: 'ERROR',
} as const

export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState]

/* -----------------------------------------------------------------------------
 * Presence (§35)
 * -------------------------------------------------------------------------- */

export const PresenceState = {
  Online: 'online',
  Idle: 'idle',
  Editing: 'editing',
  Offline: 'offline',
} as const

export type PresenceState = (typeof PresenceState)[keyof typeof PresenceState]

/**
 * A collaborator in the document right now.
 *
 * `colorIndex` is assigned by the *server* rather than by each client, so
 * everyone sees Maria in the same colour. Deriving it locally from join order
 * would give every client a different mapping. (§36)
 */
export interface Participant {
  user: DocumentCollaborator
  state: PresenceState
  colorIndex: number
  /**
   * Which document they are in.
   *
   * Carried per participant rather than assumed from the connection, because
   * presence is a workspace-level concept the moment there is more than one
   * open tab — "Maria is in Payment Requirements" is answerable from a roster
   * that records where each person is.
   */
  documentId: string
  /** Caret position and selection, in document character offsets. */
  cursor: CursorPosition | null
  /** Last time this person did anything. Drives the idle/offline decay. */
  lastSeenAt: string
}

export interface CursorPosition {
  /** Caret offset. */
  anchor: number
  /** Selection end; equal to `anchor` when nothing is selected. */
  head: number
}

/* -----------------------------------------------------------------------------
 * Document save/sync state (§37, §69)
 * -------------------------------------------------------------------------- */

export const SyncState = {
  /** No unsaved changes and the socket is healthy. */
  Synced: 'synced',
  /** Local edits are being sent. */
  Saving: 'saving',
  /** Written, waiting for the confirmation frame. */
  Saved: 'saved',
  /** Edits are queued locally because the connection is down. */
  Offline: 'offline',
  Error: 'error',
} as const

export type SyncState = (typeof SyncState)[keyof typeof SyncState]

/* -----------------------------------------------------------------------------
 * Events (§55, §81)
 *
 * Named exactly as the backend contract specifies. Outbound and inbound are
 * separate unions: a client that can send `document.presence` could forge
 * another user's presence, and the type system should make that impossible
 * rather than relying on nobody trying.
 * -------------------------------------------------------------------------- */

export const DocumentEvent = {
  Join: 'document.join',
  Leave: 'document.leave',
  Update: 'document.update',
  Sync: 'document.sync',
  Cursor: 'document.cursor',
  Selection: 'document.selection',
  Presence: 'document.presence',
  Saved: 'document.saved',
  Error: 'document.error',
} as const

/**
 * Liveness frames, outside the `document.*` namespace.
 *
 * Separate because they are a property of the *connection*, not of a document:
 * a socket carrying no document traffic still has to prove it is alive. A TCP
 * connection can be half-open for minutes — the client believes it is
 * connected, the server has already forgotten it, and nothing is delivered
 * until something tries to write. An application-level ping is the only thing
 * that detects that.
 */
export const SystemEvent = {
  Ping: 'system.ping',
  Pong: 'system.pong',
} as const

export type SystemEvent = (typeof SystemEvent)[keyof typeof SystemEvent]

export type DocumentEvent = (typeof DocumentEvent)[keyof typeof DocumentEvent]

/** Frames this client sends. */
export type OutboundMessage =
  | { type: typeof SystemEvent.Ping; sentAt: number }
  | { type: typeof DocumentEvent.Join; documentId: string }
  | { type: typeof DocumentEvent.Leave; documentId: string }
  | {
      type: typeof DocumentEvent.Update
      documentId: string
      content: string
      /** The revision this edit was made against, for conflict detection. */
      baseRevision: number
    }
  | { type: typeof DocumentEvent.Cursor; documentId: string; cursor: CursorPosition }
  | { type: typeof DocumentEvent.Selection; documentId: string; cursor: CursorPosition }

/** Frames the server sends. */
export type InboundMessage =
  | { type: typeof SystemEvent.Pong; sentAt: number }
  /** Someone opened the document. Additive — no full roster replacement. */
  | { type: typeof DocumentEvent.Join; documentId: string; participant: Participant }
  /** Someone closed it, or their socket dropped. */
  | { type: typeof DocumentEvent.Leave; documentId: string; userId: string }
  | { type: typeof DocumentEvent.Sync; documentId: string; content: string; revision: number }
  | {
      type: typeof DocumentEvent.Update
      documentId: string
      content: string
      revision: number
      actorId: string
    }
  | { type: typeof DocumentEvent.Presence; documentId: string; participants: Participant[] }
  | {
      type: typeof DocumentEvent.Cursor
      documentId: string
      userId: string
      cursor: CursorPosition | null
    }
  | { type: typeof DocumentEvent.Saved; documentId: string; revision: number; savedAt: string }
  | { type: typeof DocumentEvent.Error; documentId: string; message: string; code?: string }

export type SocketMessage = InboundMessage | OutboundMessage

/** Anything that can move frames — a real socket, or the mock. */
export interface Transport {
  send: (message: OutboundMessage) => void
  close: () => void
}

/**
 * Why the socket dropped, for the UI and for deciding whether to retry.
 *
 * An auth failure must NOT be retried: reconnecting with the same rejected
 * credential just burns the backoff schedule against a server that will keep
 * saying no.
 */
export const DisconnectReason = {
  Clean: 'clean',
  Network: 'network',
  AuthFailed: 'auth_failed',
  ServerError: 'server_error',
} as const

export type DisconnectReason = (typeof DisconnectReason)[keyof typeof DisconnectReason]

export interface TransportHandlers {
  onOpen: () => void
  onMessage: (message: InboundMessage) => void
  onClose: (info: { wasClean: boolean; reason: DisconnectReason }) => void
  onError: (error: unknown) => void
}
