import { describe, expect, it } from 'vitest'

import { normalizeUrl } from '@/utils/url'

/**
 * Link validation. (CLAUDE.md §66)
 *
 * A document is user-generated content shared across a workspace, so a hostile
 * href must never reach stored content. These are the security cases.
 */

describe('normalizeUrl', () => {
  it('upgrades a bare domain to https, which is what people type', () => {
    expect(normalizeUrl('streamsync.app/docs')).toBe('https://streamsync.app/docs')
  })

  it('keeps an explicit protocol', () => {
    expect(normalizeUrl('http://example.com/')).toBe('http://example.com/')
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('allows mailto links', () => {
    expect(normalizeUrl('mailto:raj@evertech.io')).toBe('mailto:raj@evertech.io')
  })

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['uppercase javascript', 'JavaScript:alert(1)'],
    ['data', 'data:text/html;base64,PHNjcmlwdD4='],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['file', 'file:///etc/passwd'],
  ])('rejects a %s URL', (_label, value) => {
    expect(normalizeUrl(value)).toBeNull()
  })

  it('rejects empty and whitespace input', () => {
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('   ')).toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com/')
  })
})
