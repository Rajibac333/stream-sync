import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

import { ErrorState } from '@/components/ui/ErrorState'
import { reportError } from '@/app/errorReporter'

/**
 * ErrorBoundary
 *
 * Scoped containment, not a global net. The point is that one failing feature
 * degrades to an error card while the rest of the app keeps working — if the AI
 * panel throws, the document editor must stay usable. (CLAUDE.md §68)
 *
 * Wrap *features*, not the whole tree, and give each boundary a `resetKey` so
 * navigating away clears the error instead of stranding the user.
 */

interface ErrorBoundaryProps {
  children: ReactNode
  /** Custom fallback; receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** Changing this value clears the error — typically the route or record id. */
  resetKey?: unknown
  /** Extra handling on top of the crash report every boundary already sends. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  /** Names the failing region in the default fallback, e.g. "AI assistant". */
  label?: string
}

interface ErrorBoundaryState {
  error: Error | null
  /** Last observed `resetKey`, tracked in state so the reset is derived. */
  observedResetKey: unknown
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    error: null,
    observedResetKey: this.props.resetKey,
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  /**
   * Clears the error when `resetKey` changes — derived during render rather
   * than via `setState` in `componentDidUpdate`, which would render the stale
   * error once before correcting itself.
   */
  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (Object.is(props.resetKey, state.observedResetKey)) return null
    return { error: null, observedResetKey: props.resetKey }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo)

    /* Reported rather than logged directly. The reporter decides where it goes
       — the console in development, a crash service in production — and is the
       one place that knows what is safe to send. (§66, §67) */
    reportError({
      error,
      source: `ErrorBoundary: ${this.props.label ?? 'component tree'}`,
      context: { componentStack: (errorInfo.componentStack ?? '').slice(0, 800) },
    })
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const { error } = this.state
    const { children, fallback, label } = this.props

    if (!error) return children
    if (fallback) return fallback(error, this.reset)

    return (
      <ErrorState
        title={label ? `${label} couldn't load` : 'Something went wrong'}
        error={error}
        description={
          label
            ? `The ${label.toLowerCase()} ran into a problem. The rest of StreamSync is still available.`
            : undefined
        }
        onRetry={this.reset}
        size="inline"
      />
    )
  }
}
