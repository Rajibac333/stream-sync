import { describe, expect, it } from 'vitest'

import { outbound, parseInbound } from '@/websocket/events'
import { DocumentEvent } from '@/websocket/types'

/**
 * Wire-format validation. (CLAUDE.md §55, §81)
 *
 * These frames arrive off a network. `as InboundMessage` on a JSON.parse is a
 * lie, and the whole point of parseInbound is that a malformed frame is dropped
 * rather than reaching React as an object that crashes a render.
 */

describe('outbound', () => {
  it('builds the frames the contract specifies', () => {
    expect(outbound.join('doc-1')).toEqual({ type: 'document.join', documentId: 'doc-1' })
    expect(outbound.update('doc-1', '<p>hi</p>', 4)).toEqual({
      type: 'document.update',
      documentId: 'doc-1',
      content: '<p>hi</p>',
      baseRevision: 4,
    })
    expect(outbound.cursor('doc-1', { anchor: 2, head: 5 })).toMatchObject({
      type: 'document.cursor',
      cursor: { anchor: 2, head: 5 },
    })
  })
})

describe('parseInbound', () => {
  it('accepts a well-formed sync frame', () => {
    expect(
      parseInbound({ type: DocumentEvent.Sync, documentId: 'd', content: '<p>x</p>', revision: 2 }),
    ).toEqual({ type: DocumentEvent.Sync, documentId: 'd', content: '<p>x</p>', revision: 2 })
  })

  it('accepts a saved frame', () => {
    const at = new Date().toISOString()
    expect(
      parseInbound({ type: DocumentEvent.Saved, documentId: 'd', revision: 3, savedAt: at }),
    ).toMatchObject({ revision: 3, savedAt: at })
  })

  it('treats a missing cursor as no cursor rather than rejecting the frame', () => {
    const parsed = parseInbound({ type: DocumentEvent.Cursor, documentId: 'd', userId: 'u' })
    expect(parsed).toMatchObject({ userId: 'u', cursor: null })
  })

  it.each([
    ['not an object', 42],
    ['null', null],
    ['no type', { documentId: 'd' }],
    ['no documentId', { type: DocumentEvent.Sync, content: 'x', revision: 1 }],
    ['sync with no content', { type: DocumentEvent.Sync, documentId: 'd', revision: 1 }],
    ['sync with a non-numeric revision', { type: DocumentEvent.Sync, documentId: 'd', content: 'x', revision: 'two' }],
    ['update with no actor', { type: DocumentEvent.Update, documentId: 'd', content: 'x', revision: 1 }],
    ['saved with no timestamp', { type: DocumentEvent.Saved, documentId: 'd', revision: 1 }],
    ['error with no message', { type: DocumentEvent.Error, documentId: 'd' }],
  ])('rejects %s', (_label, payload) => {
    expect(parseInbound(payload)).toBeNull()
  })

  it('drops an unknown event type instead of throwing', () => {
    // A newer server talking to an older client. Forward compatibility means
    // ignoring what you do not understand.
    expect(parseInbound({ type: 'document.telepathy', documentId: 'd' })).toBeNull()
  })

  it('carries an optional error code through when present', () => {
    expect(
      parseInbound({ type: DocumentEvent.Error, documentId: 'd', message: 'nope', code: 'conflict' }),
    ).toMatchObject({ message: 'nope', code: 'conflict' })
  })
})
