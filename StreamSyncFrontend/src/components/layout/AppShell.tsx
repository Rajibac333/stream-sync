import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { MobileNav } from '@/components/layout/MobileNav'
import { Sidebar } from '@/components/layout/Sidebar'
import { SkipLink, MAIN_CONTENT_ID } from '@/components/layout/SkipLink'
import { RouteFallback } from '@/components/layout/RouteFallback'
import { Topbar } from '@/components/layout/Topbar'
import { CommandMenu } from '@/components/navigation/CommandMenu'
import { CreateDialogs } from '@/components/workspace/CreateDialogs'
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts'

/**
 * Authenticated application shell. (CLAUDE.md §27)
 *
 * Sidebar + topbar + content, as a layout route — pages render into the
 * <Outlet/> and never concern themselves with chrome.
 *
 * Three deliberate choices:
 *
 *   • The error boundary wraps only the <Outlet/>. A page that throws is
 *     replaced by an error card *inside* the shell, so the user still has
 *     navigation to get out with, rather than being dropped on a blank
 *     document. Keying it to the pathname clears the error on navigation, so
 *     one bad route does not poison every subsequent one. (§68)
 *
 *   • Overlays (drawer, command menu) are mounted here, once, rather than per
 *     page. They portal to <body>, so their position in this tree only decides
 *     their lifetime.
 *
 *   • `min-w-0` on the content column. Without it a flex child refuses to
 *     shrink below its content's intrinsic width, and one wide table or long
 *     unbroken string pushes the whole layout sideways.
 */
export function AppShell() {
  const { pathname } = useLocation()
  useGlobalShortcuts()

  return (
    <div className="flex min-h-dvh bg-background">
      <SkipLink />
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />

        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 outline-none">
          <ErrorBoundary label="This page" resetKey={pathname}>
            {/* Route chunks are lazy, so the shell keeps the sidebar and topbar
                on screen while one loads instead of blanking the page. */}
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <MobileNav />
      <CommandMenu />
      <CreateDialogs />
    </div>
  )
}
