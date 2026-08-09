import type { AxiosRequestConfig } from 'axios'

import { api, notImplemented } from '@/api/client'
import { tokenStorage } from '@/api/tokenStorage'
import type {
  AuthSession,
  LoginCredentials,
  PasswordResetRequest,
  RegisterPayload,
  User,
} from '@/types/auth'

/**
 * Authentication service.
 *
 * The single seam between the app and "how authentication actually happens".
 * Everything above this file — hooks, forms, guards — is written against
 * `authApi`. (§25, §51)
 *
 * TWO PROPERTIES OF THE DJANGO CONTRACT, BOTH LOAD-BEARING
 *
 *   1. `POST /auth/refresh/` returns the current user alongside a fresh access
 *      token, so a page reload restores the session in one round trip.
 *   2. Django sets the refresh token as an httpOnly cookie. The client sends
 *      `withCredentials: true` and never reads it. (api/tokenStorage.ts)
 */

/** Auth endpoints must bypass the 401-refresh interceptor or they recurse. */
const NO_REFRESH: AxiosRequestConfig = { skipAuthRefresh: true } as AxiosRequestConfig

/* -----------------------------------------------------------------------------
 * Wire format
 *
 * DRF is snake_case; the application is camelCase. Translating in exactly one
 * place keeps the convention mismatch out of every component that renders a
 * user. (CLAUDE.md §23)
 * -------------------------------------------------------------------------- */

interface UserDto {
  id: string
  name: string
  email: string
  avatar_url: string | null
  title: string | null
  created_at: string
}

interface SessionDto {
  user: UserDto
  access: string
  expires_at: string
}

function toUser(dto: UserDto): User {
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    avatarUrl: dto.avatar_url,
    title: dto.title,
    createdAt: dto.created_at,
  }
}

function toSession(dto: SessionDto): AuthSession {
  return {
    user: toUser(dto.user),
    accessToken: dto.access,
    expiresAt: dto.expires_at,
  }
}

/**
 * Every path that produces a session funnels through here, so the in-memory
 * access token can never fall out of step with the session the UI is showing.
 */
function adopt(session: AuthSession): AuthSession {
  tokenStorage.set(session.accessToken)
  return session
}

/* -----------------------------------------------------------------------------
 * Service
 * -------------------------------------------------------------------------- */

export const authApi = {
  async login(credentials: LoginCredentials): Promise<AuthSession> {
    const dto = await api.post<SessionDto>(
      '/auth/login/',
      {
        email: credentials.email,
        password: credentials.password,
        remember_me: credentials.rememberMe,
      },
      NO_REFRESH,
    )
    return adopt(toSession(dto))
  },

  async register(payload: RegisterPayload): Promise<AuthSession> {
    const dto = await api.post<SessionDto>('/auth/register/', payload, NO_REFRESH)
    return adopt(toSession(dto))
  },

  /**
   * POST /auth/google/ — exchanges a verified Google ID token for a session.
   *
   * `credential` is the JWT Google's own Identity Services button hands to its
   * callback, forwarded unchanged. Nothing about it is trusted client-side; the
   * server verifies the signature against Google's public keys before this
   * call can return anything but a rejection. Creates the account
   * automatically on a first sign-in — there is no separate "register with
   * Google" step for the caller to orchestrate.
   */
  async googleLogin(credential: string, rememberMe = true): Promise<AuthSession> {
    const dto = await api.post<SessionDto>(
      '/auth/google/',
      { credential, remember_me: rememberMe },
      NO_REFRESH,
    )
    return adopt(toSession(dto))
  },

  async logout(): Promise<void> {
    try {
      // Server-side revocation clears the httpOnly refresh cookie.
      await api.post<void>('/auth/logout/', {}, NO_REFRESH)
    } finally {
      // The local session ends even if the server call failed. A user who
      // clicked "sign out" must not still be signed in because of a 502.
      tokenStorage.clear()
    }
  },

  /**
   * Restores the session on boot. Resolves to `null` when nobody is signed in —
   * that is an ordinary outcome, not a failure, and must not surface as an
   * error state on the login screen.
   */
  async getSession(): Promise<AuthSession | null> {
    try {
      const dto = await api.post<SessionDto>('/auth/refresh/', {}, NO_REFRESH)
      return adopt(toSession(dto))
    } catch {
      // No valid refresh cookie. Signed out is the answer, not an exception.
      tokenStorage.clear()
      return null
    }
  },

  /**
   * Not available against the live API.
   *
   * Password reset needs a mail pipeline the backend does not have, so
   * `POST /api/auth/password-reset/` does not exist. Saying so is better than
   * letting the form show "check your inbox" for a message that will never
   * arrive — a reset flow that silently does nothing is worse than one that is
   * plainly absent.
   */
  async requestPasswordReset(_request: PasswordResetRequest): Promise<void> {
    throw notImplemented(
      'Password reset isn’t available yet. Ask a workspace owner to help you back in.',
    )
  },
}
