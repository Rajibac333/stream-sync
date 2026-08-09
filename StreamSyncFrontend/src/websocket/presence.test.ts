import { describe, expect, it } from 'vitest'

import {
  applyCursor,
  applyJoin,
  applyLeave,
  applyPresenceSnapshot,
  decayPresence,
  editingParticipants,
  emptyPresence,
  markEditing,
  participantsInDocument,
  participantsWithCursors,
  sortedForDisplay,
} from '@/websocket/presence'
import { PresenceState, type Participant } from '@/websocket/types'

/**
 * Presence rules. (CLAUDE.md §35, §36)
 *
 * The decay rules are the ones worth locking: "Maria is editing…" that never
 * clears is worse than no indicator, and it only clears because of this code.
 */

function participant(
  id: string,
  overrides: Partial<Participant> = {},
): Participant {
  return {
    user: { id, name: `User ${id}`, avatarUrl: null },
    state: PresenceState.Online,
    colorIndex: 1,
    documentId: 'doc-1',
    cursor: null,
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  }
}

const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString()

describe('applyPresenceSnapshot', () => {
  it('replaces the roster wholesale', () => {
    const first = applyPresenceSnapshot([participant('a'), participant('b')])
    expect(first.size).toBe(2)

    const second = applyPresenceSnapshot([participant('c')])
    expect([...second.keys()]).toEqual(['c'])
  })
})

describe('applyCursor', () => {
  it('moves a known participant’s caret', () => {
    const current = applyPresenceSnapshot([participant('a')])
    const next = applyCursor(current, 'a', { anchor: 12, head: 20 })
    expect(next.get('a')?.cursor).toEqual({ anchor: 12, head: 20 })
  })

  it('ignores someone who is not in the room', () => {
    const current = applyPresenceSnapshot([participant('a')])
    // Same reference back — nothing changed, so React can skip the render.
    expect(applyCursor(current, 'ghost', { anchor: 1, head: 1 })).toBe(current)
  })
})

describe('decayPresence', () => {
  it('drops editing back to online once typing stops', () => {
    const current = applyPresenceSnapshot([
      participant('a', { state: PresenceState.Editing, lastSeenAt: agoIso(5_000) }),
    ])
    expect(decayPresence(current).get('a')?.state).toBe(PresenceState.Online)
  })

  it('keeps editing while it is still recent', () => {
    const current = applyPresenceSnapshot([
      participant('a', { state: PresenceState.Editing, lastSeenAt: agoIso(500) }),
    ])
    expect(decayPresence(current).get('a')?.state).toBe(PresenceState.Editing)
  })

  it('drops online to idle after a long silence', () => {
    const current = applyPresenceSnapshot([
      participant('a', { state: PresenceState.Online, lastSeenAt: agoIso(120_000) }),
    ])
    expect(decayPresence(current).get('a')?.state).toBe(PresenceState.Idle)
  })

  it('returns the same map when nothing decayed', () => {
    const current = applyPresenceSnapshot([participant('a')])
    expect(decayPresence(current)).toBe(current)
  })

  it('survives an unparseable timestamp instead of throwing', () => {
    const current = applyPresenceSnapshot([participant('a', { lastSeenAt: 'not-a-date' })])
    expect(() => decayPresence(current)).not.toThrow()
  })
})

describe('selectors', () => {
  it('never counts the local user as a collaborator', () => {
    const current = applyPresenceSnapshot([
      participant('me', { state: PresenceState.Editing }),
      participant('other', { state: PresenceState.Editing }),
    ])
    expect(editingParticipants(current, 'me').map((p) => p.user.id)).toEqual(['other'])
  })

  it('only draws carets for people who have one', () => {
    const current = applyPresenceSnapshot([
      participant('a', { cursor: { anchor: 3, head: 3 } }),
      participant('b'),
      participant('c', { cursor: { anchor: 9, head: 9 }, state: PresenceState.Offline }),
    ])
    expect(participantsWithCursors(current, 'me').map((p) => p.user.id)).toEqual(['a'])
  })

  it('orders the avatar strip by activity, then name', () => {
    const current = applyPresenceSnapshot([
      participant('z', { state: PresenceState.Online }),
      participant('offline', { state: PresenceState.Offline }),
      participant('typing', { state: PresenceState.Editing }),
      participant('idle', { state: PresenceState.Idle }),
    ])
    expect(sortedForDisplay(current).map((p) => p.user.id)).toEqual([
      'typing',
      'z',
      'idle',
      'offline',
    ])
  })
})

describe('markEditing', () => {
  it('flags a participant and refreshes their timestamp', () => {
    const current = applyPresenceSnapshot([participant('a', { lastSeenAt: agoIso(30_000) })])
    const next = markEditing(current, 'a')

    expect(next.get('a')?.state).toBe(PresenceState.Editing)
    expect(Date.parse(next.get('a')?.lastSeenAt ?? '')).toBeGreaterThan(Date.now() - 2_000)
  })

  it('is a no-op for an unknown user', () => {
    expect(markEditing(emptyPresence(), 'ghost').size).toBe(0)
  })
})

describe('join and leave', () => {
  it('adds an arriving participant without disturbing the rest', () => {
    const current = applyPresenceSnapshot([
      participant('a', { cursor: { anchor: 10, head: 10 } }),
    ])
    const next = applyJoin(current, participant('b'))

    expect([...next.keys()].sort()).toEqual(['a', 'b'])
    // An arrival must not reset anyone else's caret.
    expect(next.get('a')?.cursor).toEqual({ anchor: 10, head: 10 })
  })

  it('replaces rather than duplicates when someone rejoins', () => {
    const current = applyPresenceSnapshot([participant('a', { state: PresenceState.Idle })])
    const next = applyJoin(current, participant('a', { state: PresenceState.Online }))

    // A reconnect is the same person, not a second one.
    expect(next.size).toBe(1)
    expect(next.get('a')?.state).toBe(PresenceState.Online)
  })

  it('removes someone who leaves', () => {
    const current = applyPresenceSnapshot([participant('a'), participant('b')])
    expect([...applyLeave(current, 'a').keys()]).toEqual(['b'])
  })

  it('takes their caret with them', () => {
    const current = applyPresenceSnapshot([
      participant('a', { cursor: { anchor: 5, head: 5 } }),
    ])
    // A stranded caret is worse than none — it implies someone is still there.
    expect(participantsWithCursors(applyLeave(current, 'a'), 'me')).toEqual([])
  })

  it('ignores a leave for someone who was never there', () => {
    const current = applyPresenceSnapshot([participant('a')])
    // A closed tab whose socket also times out server-side sends two leaves.
    expect(applyLeave(current, 'ghost')).toBe(current)
  })
})

describe('participantsInDocument', () => {
  it('filters presence to one document', () => {
    const current = applyPresenceSnapshot([
      participant('a', { documentId: 'doc-1' }),
      participant('b', { documentId: 'doc-2' }),
      participant('c', { documentId: 'doc-1' }),
    ])
    expect(participantsInDocument(current, 'doc-1').map((p) => p.user.id)).toEqual(['a', 'c'])
  })
})
