import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { installGlobalErrorHandlers } from '@/app/errorReporter'
import { AppProviders } from '@/app/providers'
import { router } from '@/app/router'
import { initThemeSync } from '@/store/themeStore'
import '@/styles/index.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element #root was not found in index.html.')
}

// Keeps a `system` theme preference following the OS mid-session. The initial
// paint was already resolved by the inline script in index.html.
initThemeSync()

/* Catches what an error boundary structurally cannot: rejected promises and
   throws from timers or event handlers, which never pass through render. */
installGlobalErrorHandlers()

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
