import {
  PresenceState,
  type CursorPosition,
  type Participant,
} from '@/websocket/types'
import type { DocumentCollaborator } from '@/types/document'

/**
 * Presence bookkeeping. (CLAUDE.md §35, §36)
 *
 * A pure reducer over participant state — no React, no socket. That is what
 * makes the interesting rules (who is editing, who went idle, when a cursor is
 * stale) testable without standing up a connection.
 */

/** Editing decays to online this long after the last keystroke. */
const EDITING_TIMEOUT_MS = 3_000

/** Online decays to idle after this long with no signal at all. */
const IDLE_TIMEOUT_MS = 60_000

export type ParticipantMap = ReadonlyMap<string, Participant>

export function emptyPresence(): ParticipantMap {
  return new Map()
}

/** Replaces the roster wholesale from a `document.presence` frame. */
export function applyPresenceSnapshot(participants: readonly Participant[]): ParticipantMap {
  return new Map(participants.map((participant) => [participant.user.id, participant]))
}

/**
 * Adds one person from a `document.join` frame.
 *
 * Additive rather than a full snapshot, because a join is the common case and
 * re-broadcasting the whole roster to everyone on every arrival is how presence
 * becomes the noisiest thing on the socket. Re-joining (a reconnect) replaces
 * the existing entry rather than duplicating it — the map is keyed by user id,
 * so the same person cannot appear twice.
 */
export function applyJoin(current: ParticipantMap, participant: Participant): ParticipantMap {
  const next = new Map(current)
  next.set(participant.user.id, participant)
  return next
}

/**
 * Removes someone on `document.leave`.
 *
 * Returns the same map when they were not there, so a duplicate leave — a
 * closed tab whose socket also times out server-side — costs nothing.
 */
export function applyLeave(current: ParticipantMap, userId: string): ParticipantMap {
  if (!current.has(userId)) return current

  const next = new Map(current)
  next.delete(userId)
  return next
}

/** Moves one participant's caret, ignoring anyone not in the roster. */
export function applyCursor(
  current: ParticipantMap,
  userId: string,
  cursor: CursorPosition | null,
): ParticipantMap {
  const participant = current.get(userId)
  if (!participant) return current

  const next = new Map(current)
  next.set(userId, { ...participant, cursor, lastSeenAt: new Date().toISOString() })
  return next
}

/** Marks a participant as actively typing. */
export function markEditing(current: ParticipantMap, userId: string): ParticipantMap {
  const participant = current.get(userId)
  if (!participant) return current

  const next = new Map(current)
  next.set(userId, {
    ...participant,
    state: PresenceState.Editing,
    lastSeenAt: new Date().toISOString(),
  })
  return next
}

/**
 * Decays stale states.
 *
 * Presence has to age on the *client*, not only on server broadcasts: if a
 * collaborator's browser is killed the server may not notice for a while, and
 * "Maria is editing…" that never clears is worse than no indicator at all.
 * Returns the same map when nothing changed, so React can skip the re-render.
 */
export function decayPresence(current: ParticipantMap, now = Date.now()): ParticipantMap {
  let changed = false
  const next = new Map(current)

  for (const [userId, participant] of current) {
    const age = now - Date.parse(participant.lastSeenAt)
    if (Number.isNaN(age)) continue

    if (participant.state === PresenceState.Editing && age > EDITING_TIMEOUT_MS) {
      next.set(userId, { ...participant, state: PresenceState.Online })
      changed = true
    } else if (participant.state === PresenceState.Online && age > IDLE_TIMEOUT_MS) {
      next.set(userId, { ...participant, state: PresenceState.Idle })
      changed = true
    }
  }

  return changed ? next : current
}

/* -----------------------------------------------------------------------------
 * Selectors
 * -------------------------------------------------------------------------- */

/** Everyone except the local user — you are not your own collaborator. */
export function otherParticipants(
  participants: ParticipantMap,
  selfId: string,
): Participant[] {
  return [...participants.values()].filter((participant) => participant.user.id !== selfId)
}

/** Who to name in "Maria is editing…". (§35) */
export function editingParticipants(
  participants: ParticipantMap,
  selfId: string,
): Participant[] {
  return otherParticipants(participants, selfId).filter(
    (participant) => participant.state === PresenceState.Editing,
  )
}

/** Collaborators with a live caret worth drawing. (§36) */
export function participantsWithCursors(
  participants: ParticipantMap,
  selfId: string,
): Participant[] {
  return otherParticipants(participants, selfId).filter(
    (participant) => participant.cursor !== null && participant.state !== PresenceState.Offline,
  )
}

/** Avatar-strip ordering: active people first, then alphabetical. (§35) */
const STATE_RANK: Record<PresenceState, number> = {
  editing: 0,
  online: 1,
  idle: 2,
  offline: 3,
}

export function sortedForDisplay(participants: ParticipantMap): Participant[] {
  return [...participants.values()].sort(
    (a, b) =>
      STATE_RANK[a.state] - STATE_RANK[b.state] || a.user.name.localeCompare(b.user.name),
  )
}

/** Builds a participant record for the local user. */
export function selfParticipant(
  user: DocumentCollaborator,
  colorIndex: number,
  documentId: string,
): Participant {
  return {
    user,
    state: PresenceState.Online,
    colorIndex,
    documentId,
    cursor: null,
    lastSeenAt: new Date().toISOString(),
  }
}

/** Everyone currently in a given document. */
export function participantsInDocument(
  participants: ParticipantMap,
  documentId: string,
): Participant[] {
  return [...participants.values()].filter(
    (participant) => participant.documentId === documentId,
  )
}
