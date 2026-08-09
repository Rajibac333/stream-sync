import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'

import { HelpButton } from '@/components/layout/KeyboardShortcutsDialog'
import { Wordmark } from '@/components/layout/Logo'
import { SidebarNav } from '@/components/layout/SidebarNav'
import { WorkspaceSwitcher } from '@/components/navigation/WorkspaceSwitcher'
import { Button } from '@/components/ui/Button'
import { primaryNavigation, secondaryNavigation } from '@/constants/navigation'
import { useDismiss } from '@/hooks/useDismiss'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useIsTabletUp } from '@/hooks/useMediaQuery'
import { useLockBodyScroll } from '@/hooks/useLockBodyScroll'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { useUiStore } from '@/store/uiStore'

/**
 * Mobile navigation drawer. (CLAUDE.md §18)
 *
 * A modal surface, so it takes on the full modal contract: focus trapped while
 * open, focus returned to the menu button on close, Escape and outside-tap to
 * dismiss, and the page behind locked against scrolling.
 *
 * Three things close it, and all three matter:
 *   • navigating — the drawer's whole purpose is completed
 *   • growing past the `md` breakpoint — the persistent sidebar takes over, and
 *     leaving an invisible focus trap mounted would strand keyboard focus
 *   • the usual dismiss gestures
 */
export function MobileNav() {
  const open = useUiStore((state) => state.mobileNavOpen)
  const setOpen = useUiStore((state) => state.setMobileNavOpen)
  const { workspace } = useActiveWorkspace()

  const panelRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const { pathname } = useLocation()
  const isTabletUp = useIsTabletUp()

  const close = useCallback(() => setOpen(false), [setOpen])

  useFocusTrap(panelRef, open)
  useLockBodyScroll(open)
  useDismiss(panelRef, close, { enabled: open })

  // Navigation completed the task the drawer exists for.
  useEffect(() => {
    setOpen(false)
  }, [pathname, setOpen])

  // The viewport grew into sidebar territory; this drawer is now unreachable
  // chrome holding a focus trap.
  useEffect(() => {
    if (isTabletUp && open) setOpen(false)
  }, [isTabletUp, open, setOpen])

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <motion.div
            className="absolute inset-0 bg-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface shadow-xl"
            initial={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.24, ease: [0.25, 1, 0.5, 1] }
            }
          >
            <div className="flex h-topbar shrink-0 items-center justify-between border-b border-border px-4">
              <Wordmark />
              <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close navigation">
                <X aria-hidden="true" />
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
              <WorkspaceSwitcher />

              <SidebarNav
                label="Main"
                items={primaryNavigation}
                workspaceId={workspace?.id ?? null}
                onNavigate={close}
                className="mt-1"
              />

              <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
                <SidebarNav
                  label="Workspace"
                  items={secondaryNavigation}
                  workspaceId={workspace?.id ?? null}
                  onNavigate={close}
                />
                <HelpButton />
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
