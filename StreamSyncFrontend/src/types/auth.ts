/**
 * Identity and session contracts.
 *
 * These describe what Django will eventually return, so the mock service and
 * the real service satisfy the same types and swapping between them is a
 * configuration change rather than a refactor. (CLAUDE.md §25, §58)
 */

/** Workspace permission levels. (CLAUDE.md §26) */
export const WorkspaceRole = {
  Owner: 'owner',
  Editor: 'editor',
  Viewer: 'viewer',
} as const

export type WorkspaceRole = (typeof WorkspaceRole)[keyof typeof WorkspaceRole]

export interface User {
  id: string
  name: string
  email: string
  /** Null renders initials — see Avatar. */
  avatarUrl: string | null
  /** Job title, e.g. "Frontend Engineer". Shown in the profile menu. */
  title: string | null
  createdAt: string
}

/**
 * What a successful authentication returns.
 *
 * `accessToken` is short-lived and kept in memory only. The refresh token is
 * deliberately absent from this type: Django sets it as an httpOnly cookie the
 * browser sends automatically, and JavaScript must never be able to read it.
 * (See api/tokenStorage.ts.)
 */
export interface AuthSession {
  user: User
  accessToken: string
  /** ISO timestamp. Lets the client refresh proactively rather than on a 401. */
  expiresAt: string
}

export interface LoginCredentials {
  email: string
  password: string
  /**
   * Asks the server for a long-lived refresh cookie instead of a session
   * cookie. It never changes how the access token is stored on the client.
   */
  rememberMe: boolean
}

export interface RegisterPayload {
  name: string
  email: string
  password: string
}

export interface PasswordResetRequest {
  email: string
}
