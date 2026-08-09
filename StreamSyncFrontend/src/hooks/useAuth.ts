import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import { authApi } from '@/api/auth'
import { queryKeys } from '@/api/queryKeys'
import type {
  AuthSession,
  LoginCredentials,
  PasswordResetRequest,
  RegisterPayload,
  User,
} from '@/types/auth'

/**
 * Session state.
 *
 * The signed-in user is *server* state, so it lives in TanStack Query under
 * `queryKeys.auth.session` rather than being mirrored into Zustand. Zustand
 * holds UI state only. Duplicating the session into a second store is how you
 * end up with a sidebar showing the previous user's name after a logout.
 * (CLAUDE.md §52, §53)
 *
 * `null` data means "definitively signed out". `undefined` (still loading) means
 * "we don't know yet" — and the route guards must treat those differently, or
 * every cold load flashes the login screen before restoring the session.
 */

/** Query options shared by the session query wherever it is read. */
const SESSION_QUERY = {
  queryKey: queryKeys.auth.session,
  queryFn: () => authApi.getSession(),
  // The session only changes through the mutations below or a 401 from the
  // interceptor, never through polling. Refetching it on window focus would
  // fire a token refresh every time the user alt-tabs back.
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  // A failed restore means "signed out", which authApi already models as null.
  // Anything that still throws is not going to succeed on a second attempt.
  retry: false,
} as const

export function useSession(): UseQueryResult<AuthSession | null> {
  return useQuery(SESSION_QUERY)
}

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  /** True until the initial session restore settles. */
  isLoading: boolean
}

/** Convenience read for components that only need the user. */
export function useAuth(): AuthState {
  const { data, isPending } = useSession()

  return {
    user: data?.user ?? null,
    isAuthenticated: data != null,
    isLoading: isPending,
  }
}

/**
 * The current user, for components rendered inside an authenticated route where
 * the session is guaranteed to exist. Throws rather than returning null so a
 * mistake surfaces at the boundary instead of as `undefined` in the UI.
 */
export function useCurrentUser(): User {
  const { data } = useSession()
  if (!data) {
    throw new Error('useCurrentUser() was called outside an authenticated route.')
  }
  return data.user
}

/* -----------------------------------------------------------------------------
 * Mutations
 * -------------------------------------------------------------------------- */

export function useLogin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (credentials: LoginCredentials) => authApi.login(credentials),
    onSuccess: (session) => {
      // Seed the cache directly: the server just told us who this is, so
      // invalidating and refetching would be a pointless second round trip.
      queryClient.setQueryData(queryKeys.auth.session, session)
    },
  })
}

export function useRegister() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: RegisterPayload) => authApi.register(payload),
    onSuccess: (session) => {
      queryClient.setQueryData(queryKeys.auth.session, session)
    },
  })
}

/** "Continue with Google" — same cache write as password login, one call. */
export function useGoogleLogin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (credential: string) => authApi.googleLogin(credential),
    onSuccess: (session) => {
      queryClient.setQueryData(queryKeys.auth.session, session)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => authApi.logout(),
    onSettled: () => {
      // Runs on failure too — see authApi.logout, which ends the local session
      // regardless. Clearing the whole cache (not just the session key) matters:
      // workspaces, notifications and search results all belong to the account
      // that just signed out and must not be visible to the next one.
      queryClient.setQueryData(queryKeys.auth.session, null)
      queryClient.clear()
    },
  })
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (request: PasswordResetRequest) => authApi.requestPasswordReset(request),
  })
}
