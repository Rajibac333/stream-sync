import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/Button.variants'
import { ErrorState } from '@/components/ui/ErrorState'
import { routes } from '@/constants/routes'

/**
 * Router `errorElement`.
 *
 * React Router does not pass the error as a prop — it must be read with
 * `useRouteError`, which is why a plain React error boundary cannot serve as an
 * `errorElement`: it would render its (empty) children and show a blank page
 * instead of the failure.
 *
 * This is the outermost net. In-shell failures are caught by the ErrorBoundary
 * around the <Outlet/> in AppShell, which keeps navigation available; this one
 * handles errors thrown before or outside that. (CLAUDE.md §61, §68)
 */
export function RouteError() {
  const error = useRouteError()

  const title = isRouteErrorResponse(error)
    ? `${error.status} — ${error.statusText}`
    : 'Something went wrong'

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <ErrorState
        title={title}
        error={error}
        description="This page couldn’t be displayed. Reloading may be enough to fix it."
        onRetry={() => window.location.reload()}
        retryLabel="Reload page"
        action={
          <Link to={routes.app.dashboard} className={buttonVariants({ variant: 'ghost' })}>
            Go to dashboard
          </Link>
        }
      />
    </main>
  )
}
