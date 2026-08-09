import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { useCallback, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { HTMLAttributes, ReactNode, RefObject } from 'react'

import { Button } from '@/components/ui/Button'
import { useDismiss } from '@/hooks/useDismiss'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useLockBodyScroll } from '@/hooks/useLockBodyScroll'
import { cn } from '@/utils/cn'

/**
 * Dialog
 *
 * A modal is the single most common place accessibility breaks, so all four
 * requirements from CLAUDE.md §19 are enforced by the component rather than
 * left to callers:
 *
 *   focus management  → useFocusTrap (traps Tab, restores focus on close)
 *   escape-to-close   → useDismiss
 *   accessible title  → `title` is required and wired via aria-labelledby
 *   correct ARIA      → role="dialog" + aria-modal, with the page behind
 *                       inert-by-portal and body scroll locked
 *
 * Rendered through a portal so no ancestor's `overflow` or `transform` can clip
 * or mis-position it.
 */

const SIZE_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
} as const

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Required — this is the dialog's accessible name. */
  title: string
  /** Optional supporting copy, wired to aria-describedby. */
  description?: string
  children?: ReactNode
  footer?: ReactNode
  size?: keyof typeof SIZE_CLASSES
  /** Hides the ✕ button. Only for flows the user must resolve via an action. */
  hideCloseButton?: boolean
  /** Blocks Escape and outside-click. Use sparingly — e.g. mid-upload. */
  dismissible?: boolean
  /** Focus this on open instead of the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  hideCloseButton = false,
  dismissible = true,
  initialFocusRef,
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const reduceMotion = useReducedMotion()

  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  useFocusTrap(panelRef, open, initialFocusRef ? { initialFocusRef } : {})
  useLockBodyScroll(open)
  useDismiss(panelRef, close, { enabled: open && dismissible })

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <motion.div
            className="absolute inset-0 bg-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.14 }}
            // Decorative: dismissal is handled by useDismiss so that keyboard
            // and pointer paths stay identical.
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            className={cn(
              'relative z-10 flex w-full flex-col overflow-hidden bg-surface shadow-xl',
              // Full-width sheet on mobile, centred panel from sm up (§18).
              'max-h-[92dvh] rounded-t-xl sm:max-h-[85dvh] sm:rounded-xl',
              'border border-border',
              SIZE_CLASSES[size],
              className,
            )}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 4 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.18, ease: [0.25, 1, 0.5, 1] }
            }
          >
            <div className="flex items-start gap-4 p-5 pb-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h2 id={titleId} className="text-h3 text-foreground">
                  {title}
                </h2>
                {description ? (
                  <p id={descriptionId} className="text-small text-foreground-muted">
                    {description}
                  </p>
                ) : null}
              </div>

              {!hideCloseButton ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={close}
                  aria-label="Close dialog"
                  className="-mr-1 -mt-1 shrink-0"
                >
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </div>

            {children ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-1">{children}</div>
            ) : null}

            {footer ? (
              <div className="flex flex-col-reverse gap-2 border-t border-border p-5 pt-4 sm:flex-row sm:justify-end">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}

/** Body text block for dialog content, with the app's reading measure. */
export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('py-2 text-body text-foreground-muted', className)} {...props} />
}
