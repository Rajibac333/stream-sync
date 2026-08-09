import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'

import { config } from '@/app/config'
import { tokenStorage } from '@/api/tokenStorage'
import { ApiErrorCode, type ApiError } from '@/types/api'

/**
 * The single HTTP entry point for the application.
 *
 * Nothing outside src/api imports axios. Components never call this directly
 * either — the path is always:
 *
 *     component → hook (TanStack Query) → API service → this client → axios
 *
 * CLAUDE.md §51, Rule 7
 */

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  /** Guards against an infinite 401 → refresh → 401 loop. */
  _retried?: boolean
  /** Opt out of the refresh dance (used by the auth endpoints themselves). */
  skipAuthRefresh?: boolean
}

export const httpClient: AxiosInstance = axios.create({
  baseURL: config.api.baseUrl,
  timeout: config.api.timeout,
  headers: { 'Content-Type': 'application/json' },
  // Required so the browser attaches the httpOnly refresh cookie. See
  // tokenStorage.ts for why the refresh token is never held in JS.
  withCredentials: true,
})

/* -----------------------------------------------------------------------------
 * Request — attach the bearer token
 * -------------------------------------------------------------------------- */

httpClient.interceptors.request.use((request: InternalAxiosRequestConfig) => {
  const token = tokenStorage.get()
  if (token) {
    const headers = AxiosHeaders.from(request.headers)
    headers.set('Authorization', `Bearer ${token}`)
    request.headers = headers
  }
  return request
})

/* -----------------------------------------------------------------------------
 * Response — silent token refresh
 *
 * Concurrent 401s must not fire N refresh calls. The first failure starts one
 * refresh; every other in-flight request awaits that same promise and then
 * replays itself.
 * -------------------------------------------------------------------------- */

let refreshPromise: Promise<string | null> | null = null

/** Overridden by the auth module in Milestone 2 to log the user out. */
let onSessionExpired: (() => void) | null = null

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const response = await httpClient.post<{ access: string }>(
      '/auth/refresh/',
      {},
      { skipAuthRefresh: true } as AxiosRequestConfig,
    )
    const token = response.data.access
    tokenStorage.set(token)
    return token
  } catch {
    tokenStorage.clear()
    onSessionExpired?.()
    return null
  }
}

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as RetriableRequestConfig | undefined

    const shouldRefresh =
      error.response?.status === 401 &&
      request !== undefined &&
      !request._retried &&
      !request.skipAuthRefresh

    if (shouldRefresh && request) {
      request._retried = true
      refreshPromise ??= refreshAccessToken().finally(() => {
        refreshPromise = null
      })

      const token = await refreshPromise
      if (token) return httpClient(request)
    }

    return Promise.reject(normalizeError(error))
  },
)

/* -----------------------------------------------------------------------------
 * Error normalization
 *
 * Axios errors are hostile to render. Every rejection leaving this module is an
 * ApiError with a message that is safe to show a user as-is. (CLAUDE.md §61)
 * -------------------------------------------------------------------------- */

const STATUS_MESSAGES: Record<number, string> = {
  400: "That request couldn't be processed. Please check the details and try again.",
  401: 'Your session has expired. Please sign in again.',
  403: "You don't have permission to do that.",
  404: "We couldn't find what you were looking for.",
  409: 'Someone else changed this first. Refresh to see the latest version.',
  422: 'Some of the information provided needs attention.',
  429: 'Too many requests. Please wait a moment and try again.',
  500: 'Something went wrong on our end. Please try again.',
  502: 'StreamSync is temporarily unreachable. Please try again shortly.',
  503: 'StreamSync is temporarily unavailable. Please try again shortly.',
  504: 'That request took too long. Please try again.',
}

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: ApiErrorCode.BadRequest,
  401: ApiErrorCode.Unauthorized,
  403: ApiErrorCode.Forbidden,
  404: ApiErrorCode.NotFound,
  409: ApiErrorCode.Conflict,
  422: ApiErrorCode.Validation,
  429: ApiErrorCode.RateLimited,
}

/**
 * The Django error envelope.
 *
 *     { "error": { "code": "VALIDATION_ERROR",
 *                  "message": "The submitted data was invalid.",
 *                  "details": { "email": ["Enter a valid email address."] } } }
 *
 * Every error the backend returns has this shape — framework errors and
 * service-layer errors alike, because they share one exception handler
 * (StreamSyncBackend/common/exceptions/handlers.py). Reading it here is what
 * lets a form highlight the offending field and show the server's sentence
 * instead of a generic "that request couldn't be processed".
 */
interface ErrorEnvelope {
  code?: string
  message?: string
  details?: unknown
}

function extractEnvelope(data: unknown): ErrorEnvelope | undefined {
  if (typeof data !== 'object' || data === null || !('error' in data)) return undefined

  const error = (data as { error: unknown }).error
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return undefined

  return error as ErrorEnvelope
}

/**
 * Field errors, from either shape.
 *
 * The envelope's `details` is the normal source. Bare DRF shapes
 * (`{ field: [msg] }`) are still accepted because Django's own 400 page for a
 * request that never reaches DRF — a rejected Host header, say — does not go
 * through the handler.
 *
 * Values arrive as arrays, but a single string is tolerated: a service-layer
 * error can attach `extra={"field": "reason"}`, and a form that silently
 * ignored it would leave the user staring at an unexplained rejection.
 */
function extractFieldErrors(data: unknown): Record<string, string[]> | undefined {
  const source = extractEnvelope(data)?.details ?? data

  if (typeof source !== 'object' || source === null || Array.isArray(source)) return undefined

  const entries = Object.entries(source as Record<string, unknown>)
    .filter(([key]) => key !== 'detail')
    .map(([key, value]): [string, string[]] => [
      key,
      Array.isArray(value) ? value.map(String) : [String(value)],
    ])
    .filter(([, messages]) => messages.length > 0)

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/** The sentence to show the user, preferring the server's own wording. */
function extractDetail(data: unknown): string | undefined {
  const message = extractEnvelope(data)?.message
  if (typeof message === 'string' && message.trim() !== '') return message

  if (typeof data === 'object' && data !== null && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail
    if (typeof detail === 'string' && detail.trim() !== '') return detail
  }
  return undefined
}

export function normalizeError(error: unknown): ApiError {
  if (axios.isCancel(error)) {
    return {
      status: 0,
      code: ApiErrorCode.Canceled,
      message: 'Request canceled.',
      retryable: false,
    }
  }

  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return {
        status: 0,
        code: ApiErrorCode.Timeout,
        message: 'That request took too long. Please check your connection and try again.',
        retryable: true,
      }
    }

    if (!error.response) {
      return {
        status: 0,
        code: ApiErrorCode.Network,
        message: "We couldn't reach StreamSync. Please check your connection.",
        retryable: true,
      }
    }

    const { status, data } = error.response
    const fieldErrors = extractFieldErrors(data)
    const serverCode = extractEnvelope(data)?.code

    return {
      status,
      code: STATUS_CODES[status] ?? (status >= 500 ? ApiErrorCode.Server : ApiErrorCode.Unknown),
      ...(serverCode ? { serverCode } : {}),
      message:
        extractDetail(data) ??
        STATUS_MESSAGES[status] ??
        'Something went wrong. Please try again.',
      ...(fieldErrors ? { fieldErrors } : {}),
      // 4xx means the request itself is wrong — replaying it changes nothing.
      retryable: status >= 500 || status === 429,
    }
  }

  return {
    status: 0,
    code: ApiErrorCode.Unknown,
    message: 'Something went wrong. Please try again.',
    retryable: false,
  }
}

/**
 * A rejection for a capability the backend does not implement.
 *
 * Used by the few service methods whose screens exist ahead of their endpoints.
 * It produces the same `ApiError` shape as a real failure — so every existing
 * error path renders it — but with a sentence that says what is actually going
 * on, instead of the opaque 404 the request would otherwise produce. Marked
 * non-retryable, because retrying will not make the feature exist.
 */
export function notImplemented(message: string): ApiError {
  return {
    status: 501,
    code: ApiErrorCode.Unknown,
    serverCode: 'NOT_IMPLEMENTED',
    message,
    retryable: false,
  }
}

/* -----------------------------------------------------------------------------
 * Thin typed verbs
 *
 * Services use these instead of raw axios so they deal in response *data*
 * rather than AxiosResponse envelopes.
 * -------------------------------------------------------------------------- */

export const api = {
  get: <T>(url: string, options?: AxiosRequestConfig) =>
    httpClient.get<T>(url, options).then((response) => response.data),

  post: <T, B = unknown>(url: string, body?: B, options?: AxiosRequestConfig) =>
    httpClient.post<T>(url, body, options).then((response) => response.data),

  put: <T, B = unknown>(url: string, body?: B, options?: AxiosRequestConfig) =>
    httpClient.put<T>(url, body, options).then((response) => response.data),

  patch: <T, B = unknown>(url: string, body?: B, options?: AxiosRequestConfig) =>
    httpClient.patch<T>(url, body, options).then((response) => response.data),

  delete: <T = void>(url: string, options?: AxiosRequestConfig) =>
    httpClient.delete<T>(url, options).then((response) => response.data),
}
