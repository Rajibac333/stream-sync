import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { ErrorState } from '@/components/ui/ErrorState'

/**
 * Renders the four states of a query so each section does not re-implement
 * them — and, more to the point, so no section quietly ships with only two.
 * (CLAUDE.md §59, §60, §61, §74)
 *
 *   pending  → the caller's skeleton, which should mirror the real layout
 *   error    → a readable message and a retry that actually refetches
 *   empty    → the caller's empty state, with its own next action
 *   success  → the content
 *
 * "Empty" is a decision only the caller can make: an empty array is empty, but
 * so is a list whose every item was filtered out, and the two deserve different
 * copy. Hence `isEmpty` rather than a length check in here.
 */

export interface QueryStateProps<TData> {
  query: UseQueryResult<TData>
  /** Shown while pending. Should occupy roughly the height of the real content. */
  loading: ReactNode
  empty: ReactNode
  /** Defaults to "no data at all". */
  isEmpty?: (data: TData) => boolean
  errorTitle?: string
  children: (data: TData) => ReactNode
}

function defaultIsEmpty(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0
  return data == null
}

export function QueryState<TData>({
  query,
  loading,
  empty,
  isEmpty = defaultIsEmpty,
  errorTitle = "Couldn't load this",
  children,
}: QueryStateProps<TData>) {
  const { data, isPending, isError, error, refetch } = query

  // `isPending` rather than `isLoading`: a query disabled while its workspace
  // id resolves is pending but not loading, and treating that as "ready" would
  // flash an empty state before the first request is even allowed to start.
  if (isPending) return <>{loading}</>

  if (isError) {
    return (
      <ErrorState size="inline" title={errorTitle} error={error} onRetry={() => void refetch()} />
    )
  }

  if (isEmpty(data)) return <>{empty}</>

  return <>{children(data)}</>
}
