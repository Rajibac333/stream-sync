import { describe, expect, it } from 'vitest'
import type { Location } from 'react-router-dom'

import { resolveRedirectTarget } from '@/utils/redirect'
import { routes } from '@/constants/routes'

/**
 * Post-login redirect. (CLAUDE.md §66)
 *
 * `location.state` is attacker-influenceable — anything can push history state —
 * so these tests are as much a security boundary as a behaviour check.
 */

function locationWith(state: unknown): Location {
  return { pathname: '/login', search: '', hash: '', state, key: 'test' } as Location
}

function from(pathname: string, search = '', hash = ''): Location {
  return locationWith({ from: { pathname, search, hash } })
}

describe('resolveRedirectTarget', () => {
  it('returns the deep link the user was originally headed to', () => {
    expect(
      resolveRedirectTarget(
        from('/app/workspaces/evertech/documents/doc-payments', '?v=2', '#requirements'),
      ),
    ).toBe('/app/workspaces/evertech/documents/doc-payments?v=2#requirements')
  })

  it.each([
    ['protocol-relative URL', '//evil.example/steal'],
    ['absolute external URL', 'https://evil.example'],
    ['relative path', 'app/dashboard'],
    ['empty path', ''],
  ])('refuses to redirect to a %s', (_label, pathname) => {
    expect(resolveRedirectTarget(from(pathname))).toBe(routes.app.dashboard)
  })

  it.each(Object.values(routes.auth))('never bounces back to %s', (authPath) => {
    // Otherwise signing in from /login would redirect straight back to /login.
    expect(resolveRedirectTarget(from(authPath))).toBe(routes.app.dashboard)
  })

  it.each([
    ['no state', null],
    ['unrelated state', { something: 'else' }],
    ['a from with no pathname', { from: {} }],
  ])('falls back to the dashboard given %s', (_label, state) => {
    expect(resolveRedirectTarget(locationWith(state))).toBe(routes.app.dashboard)
  })
})
