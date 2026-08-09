import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { AppBootScreen } from '@/components/layout/AppBootScreen'
import { useAuth } from '@/hooks/useAuth'
import { routes } from '@/constants/routes'
import { resolveRedirectTarget } from '@/utils/redirect'

/**
 * Route protection.
 *
 * Both guards are layout routes: they render an <Outlet/> rather than wrapping
 * children, so protection is declared once in the route table instead of being
 * remembered on every page.
 *
 * IMPORTANT — this is UX, not security. It decides what to *render*; it does
 * not decide what a user may *do*. Anyone can edit the JavaScript running in
 * their own browser. Every authorisation decision that matters is Django's.
 * (CLAUDE.md §26)
 */

/** Gate for the authenticated application. */
export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  // "Not signed in" and "not known yet" are different answers, and only the
  // first one justifies a redirect. Without this, every cold load of a deep
  // link flashes the login screen before restoring the session.
  if (isLoading) return <AppBootScreen />

  if (!isAuthenticated) {
    return (
      <Navigate
        to={routes.auth.login}
        replace
        // Carried so signing in returns the user to the deep link they opened,
        // which is what makes shared document URLs work.
        state={{
          from: { pathname: location.pathname, search: location.search, hash: location.hash },
        }}
      />
    )
  }

  return <Outlet />
}

/** Keeps a signed-in user off the sign-in, register and reset screens. */
export function RedirectIfAuthenticated() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <AppBootScreen />
  if (isAuthenticated) return <Navigate to={resolveRedirectTarget(location)} replace />

  return <Outlet />
}
