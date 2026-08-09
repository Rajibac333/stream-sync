/**
 * Transport-level types shared by every API service.
 *
 * Domain models (Workspace, Project, Document, …) are defined in their own
 * milestones; this file only describes the *shape of the pipe*.
 */

/** DRF pagination envelope. */
export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

/** Normalized failure. Every rejection out of the API client is one of these. */
export interface ApiError {
  /** HTTP status, or 0 when the request never reached the server. */
  status: number
  /** Stable machine-readable code for branching. */
  code: ApiErrorCode
  /**
   * The backend's own error code, verbatim — `DOCUMENT_REVISION_CONFLICT`,
   * `AI_SERVICE_UNAVAILABLE`, `USER_NOT_REGISTERED` and so on.
   *
   * Separate from `code` on purpose. `code` is the transport classification
   * every caller branches on and is a closed union; this is the open-ended
   * domain code, carried for the handful of places that want to say something
   * specific about *why* rather than *what kind*. Absent when the failure never
   * reached the server.
   */
  serverCode?: string
  /** Human-readable, safe to render directly. (CLAUDE.md §61) */
  message: string
  /** Field errors: `{ email: ['Enter a valid email address.'] }`. */
  fieldErrors?: Record<string, string[]>
  /** Whether retrying the exact same request could plausibly succeed. */
  retryable: boolean
}

export const ApiErrorCode = {
  Network: 'network',
  Timeout: 'timeout',
  Canceled: 'canceled',
  BadRequest: 'bad_request',
  Unauthorized: 'unauthorized',
  Forbidden: 'forbidden',
  NotFound: 'not_found',
  Conflict: 'conflict',
  Validation: 'validation',
  RateLimited: 'rate_limited',
  Server: 'server',
  Unknown: 'unknown',
} as const

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode]

export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'status' in error &&
    'message' in error
  )
}
