import { QueryClient } from '@tanstack/react-query'

import { ApiErrorCode, isApiError } from '@/types/api'

/**
 * TanStack Query owns all server state. Zustand owns UI state only, and the two
 * never mirror each other. (CLAUDE.md §52, §53)
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Workspace data changes because a *collaborator* changed it, and that
        // arrives over the WebSocket rather than by polling. Queries stay fresh
        // for a beat and are re-validated on focus; Milestone 6 wires socket
        // events straight into the cache.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          // Retrying a 403 or a 404 just burns the user's time.
          if (isApiError(error) && !error.retryable) return false
          return failureCount < 2
        },
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
      },
      mutations: {
        // A failed mutation is a user-visible action; surface it rather than
        // silently replaying a possibly non-idempotent request.
        retry: false,
      },
    },
  })
}

/** True when the failure should send the user to the login screen. */
export function isAuthError(error: unknown): boolean {
  return isApiError(error) && error.code === ApiErrorCode.Unauthorized
}
