import type { Location } from 'react-router-dom'

import { routes } from '@/constants/routes'

/**
 * Post-login redirect handling.
 *
 * Kept out of routeGuards.tsx so that file exports components only — a module
 * mixing components and helpers is not a valid Fast Refresh boundary, and edits
 * to it force a full reload instead of a hot update.
 */

/** Where the user was headed before being bounced to sign in. */
export interface RedirectState {
  from?: Pick<Location, 'pathname' | 'search' | 'hash'>
}

function isRedirectState(value: unknown): value is RedirectState {
  return typeof value === 'object' && value !== null && 'from' in value
}

/**
 * Reads the intended destination out of location state.
 *
 * The path is validated before use. `location.state` is attacker-influenceable
 * — anything can push history state — so an unchecked value here would turn the
 * login screen into an open redirect: sign in, land on someone else's site.
 * Only same-origin absolute paths are honoured; everything else falls back to
 * the dashboard.
 */
export function resolveRedirectTarget(location: Location): string {
  if (!isRedirectState(location.state) || !location.state.from) return routes.app.dashboard

  const { pathname, search, hash } = location.state.from

  // Rejects "//evil.example" (protocol-relative), "https://…" and any relative
  // path that could escape the app.
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) {
    return routes.app.dashboard
  }

  // Never send the user back to an auth screen they just completed.
  const authPaths: readonly string[] = Object.values(routes.auth)
  if (authPaths.includes(pathname)) return routes.app.dashboard

  return `${pathname}${search ?? ''}${hash ?? ''}`
}
