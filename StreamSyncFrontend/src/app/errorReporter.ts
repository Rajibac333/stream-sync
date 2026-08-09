import { config } from '@/app/config'
import { isApiError } from '@/types/api'

/**
 * Crash reporting seam. (CLAUDE.md §67, §68)
 *
 * WHY THIS EXISTS RATHER THAN AN SDK
 *
 * Production triage needs somewhere for uncaught errors to go, but picking the
 * vendor is an operations decision, not a frontend one — and adding an SDK
 * before anyone has an account for it would be a dependency that earns nothing
 * (§7, Rule 5). This is the seam: one `install()` call in main.tsx, and
 * whichever service is chosen is wired up in one place.
 *
 * Until then it does the only genuinely useful thing available without a
 * backend — captures what would have been reported, and logs it in development
 * so a crash during a demo is not silent.
 *
 * WHAT IS DELIBERATELY NOT SENT
 *
 * No request bodies, no access token, no form values, no document content.
 * A crash reporter is the classic way sensitive data leaks out of a product:
 * it is trusted, it is quiet, and it sends whatever it was handed. Only the
 * error, where it happened, and a coarse breadcrumb ever leave here. (§66, §67)
 */

export interface ErrorReport {
  error: unknown
  /** Where it came from, e.g. "ErrorBoundary: document editor". */
  source: string
  /** Non-sensitive context only — ids and route names, never content. */
  context?: Record<string, string | number | boolean | null>
}

type Sink = (report: NormalizedReport) => void

export interface NormalizedReport {
  name: string
  message: string
  stack: string | null
  source: string
  context: Record<string, string | number | boolean | null>
  occurredAt: string
}

/**
 * Reduces anything throwable to a reportable shape.
 *
 * `ApiError` is unwrapped rather than stringified, so a 500 arrives as a
 * server error with its status rather than as "[object Object]".
 */
function normalize({ error, source, context = {} }: ErrorReport): NormalizedReport {
  const occurredAt = new Date().toISOString()

  if (isApiError(error)) {
    return {
      name: `ApiError(${error.code})`,
      message: error.message,
      stack: null,
      source,
      context: { ...context, status: error.status },
      occurredAt,
    }
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      source,
      context,
      occurredAt,
    }
  }

  return {
    name: 'UnknownError',
    message: typeof error === 'string' ? error : 'A non-Error value was thrown.',
    stack: null,
    source,
    context,
    occurredAt,
  }
}

/** Development sink. Replaced by `setErrorSink` when a service is wired up. */
const devSink: Sink = (report) => {
  if (!config.isDev) return
  // Intentional and development-only: without it a caught crash is invisible.
  console.error(`[StreamSync] ${report.source}:`, report.name, report.message, report.context)
}

let sink: Sink = devSink

/**
 * Points reporting at a real service.
 *
 * Call once from main.tsx, e.g.
 *
 *   setErrorSink((report) => Sentry.captureException(...))
 */
export function setErrorSink(next: Sink | null): void {
  sink = next ?? devSink
}

export function reportError(report: ErrorReport): void {
  try {
    sink(normalize(report))
  } catch {
    // A failing reporter must never become the error. Swallowed on purpose.
  }
}

/**
 * Catches what React cannot.
 *
 * An error boundary only sees errors thrown during render. A rejected promise
 * in an event handler, or a throw inside a `setTimeout`, bypasses it entirely —
 * and those are exactly the failures that go unnoticed in production.
 */
export function installGlobalErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) => {
    reportError({ error: event.error ?? event.message, source: 'window.error' })
  }

  const onRejection = (event: PromiseRejectionEvent) => {
    reportError({ error: event.reason, source: 'unhandledrejection' })
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
