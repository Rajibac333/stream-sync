/**
 * Access-token custody.
 *
 * The access token is held in module memory — deliberately NOT in localStorage
 * or a non-httpOnly cookie. A token in localStorage is readable by any script
 * that manages to execute on the page, which turns a single XSS into full
 * account takeover with a token that outlives the tab.
 *
 * The intended pairing on the Django side is:
 *
 *   access token   →  short-lived, returned in the login response body,
 *                     kept here in memory, gone on refresh
 *   refresh token  →  httpOnly + Secure + SameSite cookie set by Django,
 *                     never visible to JavaScript
 *
 * That is why the API client sends `withCredentials: true`: the browser
 * attaches the refresh cookie to `POST /auth/refresh/` without this code ever
 * being able to read it. A page reload therefore starts tokenless and silently
 * re-authenticates from the cookie.
 *
 * CLAUDE.md §25, §66
 */

let accessToken: string | null = null

type Listener = (token: string | null) => void
const listeners = new Set<Listener>()

export const tokenStorage = {
  get(): string | null {
    return accessToken
  },

  set(token: string | null): void {
    accessToken = token
    for (const listener of listeners) listener(token)
  },

  clear(): void {
    tokenStorage.set(null)
  },

  /** Notifies on login/logout/refresh so the auth store can react. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
