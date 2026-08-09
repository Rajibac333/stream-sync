import {
  DocumentEvent,
  PresenceState,
  SystemEvent,
  type CursorPosition,
  type InboundMessage,
  type OutboundMessage,
  type Participant,
} from '@/websocket/types'

/**
 * Frame construction and validation. (CLAUDE.md §55)
 *
 * Everything crossing the socket boundary passes through here. Two reasons
 * that matters:
 *
 *  1. Outbound frames are built by named helpers rather than object literals
 *     scattered across the app, so the wire format is changed in one place.
 *
 *  2. Inbound frames are *validated*, not cast. A `as InboundMessage` on
 *     `JSON.parse` is a lie — the bytes came off a network and may be
 *     anything. An unrecognised frame is dropped rather than allowed to reach
 *     React as a malformed object that crashes a render three layers away.
 */

/* -----------------------------------------------------------------------------
 * Outbound
 * -------------------------------------------------------------------------- */

export const outbound = {
  ping: (): OutboundMessage => ({ type: SystemEvent.Ping, sentAt: Date.now() }),

  join: (documentId: string): OutboundMessage => ({ type: DocumentEvent.Join, documentId }),

  leave: (documentId: string): OutboundMessage => ({ type: DocumentEvent.Leave, documentId }),

  update: (documentId: string, content: string, baseRevision: number): OutboundMessage => ({
    type: DocumentEvent.Update,
    documentId,
    content,
    baseRevision,
  }),

  cursor: (documentId: string, cursor: CursorPosition): OutboundMessage => ({
    type: DocumentEvent.Cursor,
    documentId,
    cursor,
  }),

  selection: (documentId: string, cursor: CursorPosition): OutboundMessage => ({
    type: DocumentEvent.Selection,
    documentId,
    cursor,
  }),
}

/* -----------------------------------------------------------------------------
 * Inbound validation
 * -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isCursor(value: unknown): value is CursorPosition {
  return isRecord(value) && isNumber(value.anchor) && isNumber(value.head)
}

const PRESENCE_STATES = new Set<string>(Object.values(PresenceState))

/**
 * Validates one participant.
 *
 * Previously the presence branch accepted any object with a `user` key and cast
 * the rest, which meant a malformed entry reached the avatar strip and the
 * caret layer as an object missing the fields they read. Now a bad entry is
 * dropped and the rest of the roster survives.
 */
function parseParticipant(value: unknown, fallbackDocumentId: string): Participant | null {
  if (!isRecord(value) || !isRecord(value.user)) return null

  const user = value.user
  if (!isString(user.id) || !isString(user.name)) return null

  const state = isString(value.state) && PRESENCE_STATES.has(value.state) ? value.state : null
  if (!state) return null

  return {
    user: {
      id: user.id,
      name: user.name,
      avatarUrl: isString(user.avatarUrl) ? user.avatarUrl : null,
    },
    state: state as Participant['state'],
    colorIndex: isNumber(value.colorIndex) ? value.colorIndex : 1,
    documentId: isString(value.documentId) ? value.documentId : fallbackDocumentId,
    cursor: isCursor(value.cursor) ? value.cursor : null,
    lastSeenAt: isString(value.lastSeenAt) ? value.lastSeenAt : new Date().toISOString(),
  }
}

/**
 * Narrows an unknown payload to a known inbound frame, or null.
 *
 * Deliberately structural rather than a schema library: this runs on every
 * frame — potentially many per second during a live edit — and Zod parsing at
 * that rate is measurable. The shapes are small and stable enough that hand
 * guards stay readable.
 */
export function parseInbound(raw: unknown): InboundMessage | null {
  if (!isRecord(raw) || !isString(raw.type)) return null

  // Liveness frames are connection-scoped and carry no document id.
  if (raw.type === SystemEvent.Pong) {
    return isNumber(raw.sentAt) ? { type: SystemEvent.Pong, sentAt: raw.sentAt } : null
  }

  if (!isString(raw.documentId)) return null

  const documentId = raw.documentId

  switch (raw.type) {
    case DocumentEvent.Join: {
      const participant = parseParticipant(raw.participant, documentId)
      return participant ? { type: DocumentEvent.Join, documentId, participant } : null
    }

    case DocumentEvent.Leave:
      return isString(raw.userId)
        ? { type: DocumentEvent.Leave, documentId, userId: raw.userId }
        : null

    case DocumentEvent.Sync:
      if (!isString(raw.content) || !isNumber(raw.revision)) return null
      return { type: DocumentEvent.Sync, documentId, content: raw.content, revision: raw.revision }

    case DocumentEvent.Update:
      if (!isString(raw.content) || !isNumber(raw.revision) || !isString(raw.actorId)) return null
      return {
        type: DocumentEvent.Update,
        documentId,
        content: raw.content,
        revision: raw.revision,
        actorId: raw.actorId,
      }

    case DocumentEvent.Presence: {
      if (!Array.isArray(raw.participants)) return null
      // Each entry is validated; a malformed one is dropped rather than taking
      // the whole roster — or the render that reads it — down with it.
      const participants = raw.participants
        .map((entry) => parseParticipant(entry, documentId))
        .filter((entry): entry is Participant => entry !== null)

      return { type: DocumentEvent.Presence, documentId, participants }
    }

    case DocumentEvent.Cursor:
      if (!isString(raw.userId)) return null
      return {
        type: DocumentEvent.Cursor,
        documentId,
        userId: raw.userId,
        cursor: isCursor(raw.cursor) ? raw.cursor : null,
      }

    case DocumentEvent.Saved:
      if (!isNumber(raw.revision) || !isString(raw.savedAt)) return null
      return {
        type: DocumentEvent.Saved,
        documentId,
        revision: raw.revision,
        savedAt: raw.savedAt,
      }

    case DocumentEvent.Error:
      if (!isString(raw.message)) return null
      return {
        type: DocumentEvent.Error,
        documentId,
        message: raw.message,
        ...(isString(raw.code) ? { code: raw.code } : {}),
      }

    default:
      // An unknown event type is not an error — it is a newer server talking to
      // an older client, and dropping it is the correct forward-compatible
      // behaviour.
      return null
  }
}
