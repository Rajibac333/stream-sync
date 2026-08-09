import { Skeleton } from '@/components/ui/Skeleton'

/**
 * Suspense fallback for lazily-loaded routes.
 *
 * A skeleton rather than a spinner or a blank screen: it holds the page's shape
 * so the layout doesn't jump when content arrives, and it reads as "this is
 * loading" instead of "this is broken". (CLAUDE.md §59)
 */
export function RouteFallback() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading page
      </span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
