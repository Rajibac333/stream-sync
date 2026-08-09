import { RefreshCw, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/Button'
import { isApiError } from '@/types/api'
import { cn } from '@/utils/cn'
import { config } from '@/app/config'

/**
 * ErrorState
 *
 * Renders a failure in language a person can act on. "Error 500" tells the user
 * nothing they can use; "Something went wrong — we couldn't load this document
 * [Try again]" tells them what failed and what to do.
 *
 * Technical detail is shown only in development. In production it is noise at
 * best and an information leak at worst. (CLAUDE.md §61, §66)
 */

export interface ErrorStateProps {
  /** Overrides the default "Something went wrong." */
  title?: string
  /**
   * The failure. An {@link ApiError} contributes its human-readable message;
   * anything else falls back to the generic copy.
   */
  error?: unknown
  /** Explicit description, wins over anything derived from `error`. */
  description?: string
  onRetry?: () => void
  retryLabel?: string
  /** Extra actions, e.g. "Back to dashboard". */
  action?: ReactNode
  size?: 'inline' | 'page'
  className?: string
}

function resolveDescription(error: unknown): string {
  if (isApiError(error)) return error.message
  return "We couldn't complete that request. Please try again."
}

/** Dev-only technical detail, never shown to end users. */
function resolveDebugDetail(error: unknown): string | null {
  if (!config.isDev) return null
  if (isApiError(error)) return `${error.code} (HTTP ${error.status})`
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return null
}

export function ErrorState({
  title = 'Something went wrong',
  error,
  description,
  onRetry,
  retryLabel = 'Try again',
  action,
  size = 'page',
  className,
}: ErrorStateProps) {
  const body = description ?? resolveDescription(error)
  const debugDetail = resolveDebugDetail(error)

  return (
    <div
      // `alert` announces immediately: an error the user must know about is one
      // of the few cases where interrupting is correct.
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'page' ? 'gap-3 px-6 py-16' : 'gap-2 px-4 py-10',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'flex items-center justify-center rounded-lg bg-danger-subtle text-danger',
          size === 'page' ? 'mb-1 size-11 [&_svg]:size-5' : 'size-9 [&_svg]:size-4',
        )}
      >
        <TriangleAlert />
      </div>

      <h3 className={cn('text-foreground', size === 'page' ? 'text-h3' : 'text-body font-semibold')}>
        {title}
      </h3>

      <p className="max-w-sm text-balance text-small text-foreground-muted">{body}</p>

      {debugDetail ? (
        <code className="rounded-sm bg-surface-muted px-1.5 py-0.5 font-mono text-caption text-foreground-subtle">
          {debugDetail}
        </code>
      ) : null}

      {onRetry || action ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <Button variant="secondary" onClick={onRetry} leadingIcon={<RefreshCw aria-hidden="true" />}>
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  )
}
