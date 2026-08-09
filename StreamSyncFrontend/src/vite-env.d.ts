/// <reference types="vite/client" />

/**
 * Typed contract for the environment.
 *
 * Only PUBLIC configuration belongs here. Anything secret — AI provider keys,
 * database URLs, signing keys — lives on the Django side and never reaches a
 * `VITE_` variable, because everything in this file is compiled into the
 * JavaScript bundle and readable by anyone with devtools.
 * (CLAUDE.md §66, §79)
 */
interface ImportMetaEnv {
  /** Base URL of the Django REST API, e.g. `http://localhost:8000/api`. */
  readonly VITE_API_BASE_URL?: string
  /** Base URL of the Django Channels WebSocket endpoint, e.g. `ws://localhost:8000/ws`. */
  readonly VITE_WS_BASE_URL?: string
  /** Request timeout in milliseconds. */
  readonly VITE_API_TIMEOUT?: string
  /** Enables the /design-system route and other in-app dev affordances. */
  readonly VITE_ENABLE_DEVTOOLS?: string
  /**
   * Google OAuth 2.0 Client ID for "Sign in with Google". Not secret — see
   * app/config.ts — but still per-environment, so it stays an env var. Unset
   * hides the button rather than rendering one that would fail.
   */
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
