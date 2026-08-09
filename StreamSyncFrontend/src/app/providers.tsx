import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ToastViewport } from '@/components/ui/Toast'
import { queryKeys } from '@/api/queryKeys'
import { setSessionExpiredHandler } from '@/api/client'
import { createQueryClient } from '@/app/queryClient'
import { toast } from '@/store/toastStore'

/**
 * Application providers.
 *
 * Order matters: the error boundary sits outermost so that a provider blowing
 * up during initialisation still renders a readable failure instead of a blank
 * page. The toast viewport is mounted once here, outside the router, so a toast
 * survives navigation. (CLAUDE.md §62, §68)
 */
export function AppProviders({ children }: { children: ReactNode }) {
  // Created in state, not at module scope: a module-level client is shared
  // across every test and every hot reload, which leaks cache between them.
  const [queryClient] = useState(createQueryClient)

  useSessionExpiryBridge(queryClient)

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {children}
        <ToastViewport />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

/**
 * Connects the API client's 401 handling to the session cache.
 *
 * The axios interceptor discovers an expired session in a module with no access
 * to React — it cannot navigate or clear a cache on its own. This is the seam:
 * when a token refresh fails for good, the session is emptied, which makes
 * `RequireAuth` redirect on the next render, and the user is told why rather
 * than being bounced to the login screen with no explanation. (§57, §69)
 */
function useSessionExpiryBridge(queryClient: QueryClient): void {
  useEffect(() => {
    setSessionExpiredHandler(() => {
      // Already signed out — a refresh failing on a public page is expected and
      // must not raise a "session expired" toast at someone who never had one.
      if (queryClient.getQueryData(queryKeys.auth.session) == null) return

      queryClient.setQueryData(queryKeys.auth.session, null)
      queryClient.clear()

      toast.warning({
        title: 'Your session expired',
        description: 'Please sign in again to continue.',
      })
    })

    return () => setSessionExpiredHandler(null)
  }, [queryClient])
}
