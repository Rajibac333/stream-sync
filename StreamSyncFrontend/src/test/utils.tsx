import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom'
import type { ReactElement, ReactNode } from 'react'

import type { AuthSession, User } from '@/types/auth'
import type { Workspace } from '@/types/workspace'
import { WorkspaceRole } from '@/types/auth'

/**
 * Test helpers.
 *
 * Rendering goes through the same providers the application uses, so a test
 * exercises the real wiring rather than a simplified stand-in that can pass
 * while the app is broken.
 */

/**
 * A QueryClient tuned for tests: no retries and no caching between tests.
 *
 * Retries are the single most common cause of a test that "sometimes" times
 * out — a deliberately-failing request quietly gets attempted three more times
 * with backoff before the assertion is allowed to run.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial history entries for the MemoryRouter. */
  initialEntries?: MemoryRouterProps['initialEntries']
  queryClient?: QueryClient
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient
  user: ReturnType<typeof userEvent.setup>
}

export function renderWithProviders(
  ui: ReactElement,
  { initialEntries = ['/'], queryClient, ...options }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const client = queryClient ?? createTestQueryClient()

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    queryClient: client,
    // Set up before render so pointer events and keyboard input are dispatched
    // the way a real user produces them, not as synthetic React events.
    user: userEvent.setup(),
  }
}

/* -----------------------------------------------------------------------------
 * Fixtures
 * -------------------------------------------------------------------------- */

export const testUser: User = {
  id: 'usr-test',
  name: 'Raj Mehta',
  email: 'raj@evertech.io',
  avatarUrl: null,
  title: 'Product Manager',
  createdAt: '2026-01-01T00:00:00.000Z',
}

export const testSession: AuthSession = {
  user: testUser,
  accessToken: 'test.token',
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
}

export const testWorkspaces: Workspace[] = [
  {
    id: 'evertech',
    name: 'EverTech',
    slug: 'evertech',
    description: 'Core product team',
    memberCount: 5,
    role: WorkspaceRole.Owner,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'northwind',
    name: 'Northwind Labs',
    slug: 'northwind',
    description: null,
    memberCount: 3,
    role: WorkspaceRole.Editor,
    createdAt: '2026-02-01T00:00:00.000Z',
  },
]
