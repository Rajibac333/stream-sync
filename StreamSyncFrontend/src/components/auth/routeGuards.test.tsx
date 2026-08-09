import { screen, waitFor } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RedirectIfAuthenticated, RequireAuth } from '@/components/auth/routeGuards'
import { renderWithProviders, testSession } from '@/test/utils'

/**
 * Route protection. (CLAUDE.md §24, §26)
 *
 * These cover the behaviour that is easy to get subtly wrong and expensive when
 * it is: the difference between "signed out" and "not known yet", and carrying
 * a deep link through sign-in so a shared document URL survives the detour.
 */

const getSession = vi.fn()
vi.mock('@/api/auth', () => ({
  authApi: { getSession: () => getSession() },
}))

/** Renders the current location's state so redirects can be inspected. */
function LocationProbe({ label }: { label: string }) {
  const location = useLocation()
  return (
    <div>
      <span>{label}</span>
      <span data-testid="location-state">{JSON.stringify(location.state)}</span>
    </div>
  )
}

const DEEP_LINK = '/app/workspaces/evertech/documents/doc-payments'

function renderRoutes(initialEntries: string[]) {
  return renderWithProviders(
    <Routes>
      <Route element={<RedirectIfAuthenticated />}>
        <Route path="/login" element={<LocationProbe label="Login screen" />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/app/dashboard" element={<div>Dashboard</div>} />
        <Route
          path="/app/workspaces/:workspaceId/documents/:documentId"
          element={<div>Document editor</div>}
        />
      </Route>
    </Routes>,
    { initialEntries },
  )
}

beforeEach(() => {
  getSession.mockReset()
})

describe('RequireAuth', () => {
  it('holds the boot screen while the session is still unknown', async () => {
    // Never resolves — the state a cold load is in for its first few hundred ms.
    getSession.mockImplementation(() => new Promise(() => undefined))
    renderRoutes([DEEP_LINK])

    // Redirecting here would flash the login screen at an already-signed-in user.
    expect(await screen.findByRole('status')).toHaveTextContent(/restoring your session/i)
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument()
  })

  it('renders the protected page once a session is restored', async () => {
    getSession.mockResolvedValue(testSession)
    renderRoutes(['/app/dashboard'])

    expect(await screen.findByText('Dashboard')).toBeInTheDocument()
  })

  it('sends a signed-out visitor to sign in', async () => {
    getSession.mockResolvedValue(null)
    renderRoutes(['/app/dashboard'])

    expect(await screen.findByText('Login screen')).toBeInTheDocument()
  })

  it('carries the attempted deep link so sign-in can return to it', async () => {
    getSession.mockResolvedValue(null)
    renderRoutes([`${DEEP_LINK}?v=2#requirements`])

    await screen.findByText('Login screen')
    expect(JSON.parse(screen.getByTestId('location-state').textContent ?? 'null')).toEqual({
      from: { pathname: DEEP_LINK, search: '?v=2', hash: '#requirements' },
    })
  })

  it('treats a failed session restore as signed out, not as a crash', async () => {
    getSession.mockRejectedValue(new Error('network down'))
    renderRoutes(['/app/dashboard'])

    expect(await screen.findByText('Login screen')).toBeInTheDocument()
  })
})

describe('RedirectIfAuthenticated', () => {
  it('keeps a signed-in user off the sign-in screen', async () => {
    getSession.mockResolvedValue(testSession)
    renderRoutes(['/login'])

    expect(await screen.findByText('Dashboard')).toBeInTheDocument()
  })

  it('returns them to the deep link they were originally after', async () => {
    getSession.mockResolvedValue(testSession)

    renderWithProviders(
      <Routes>
        <Route element={<RedirectIfAuthenticated />}>
          <Route path="/login" element={<div>Login screen</div>} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route
            path="/app/workspaces/:workspaceId/documents/:documentId"
            element={<div>Document editor</div>}
          />
        </Route>
      </Routes>,
      {
        initialEntries: [
          { pathname: '/login', state: { from: { pathname: DEEP_LINK, search: '', hash: '' } } },
        ],
      },
    )

    expect(await screen.findByText('Document editor')).toBeInTheDocument()
  })

  it('lets a signed-out visitor see the sign-in screen', async () => {
    getSession.mockResolvedValue(null)
    renderRoutes(['/login'])

    await waitFor(() => expect(screen.getByText('Login screen')).toBeInTheDocument())
  })
})
