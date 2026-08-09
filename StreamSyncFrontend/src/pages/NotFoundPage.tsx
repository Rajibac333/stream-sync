import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Wordmark } from '@/components/layout/Logo'
import { buttonVariants } from '@/components/ui/Button.variants'
import { EmptyState } from '@/components/ui/EmptyState'
import { routes } from '@/constants/routes'

/**
 * 404.
 *
 * Deliberately outside the app shell: an unrecognised URL may well be reached
 * by someone who is not signed in, and rendering a sidebar full of workspace
 * navigation for them would be both wrong and a small information leak.
 */
export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="p-4 sm:p-6">
        <Link
          to={routes.home}
          className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        >
          <Wordmark />
        </Link>
      </div>

      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <EmptyState
          icon={<Compass />}
          title="This page doesn’t exist"
          description="The link may be out of date, or the page may have moved."
          action={
            <Link
              to={routes.app.dashboard}
              className={buttonVariants({ variant: 'primary' })}
            >
              Go to dashboard
            </Link>
          }
        />
      </main>
    </div>
  )
}
