import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { cloneElement, useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'

import { useDismiss } from '@/hooks/useDismiss'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { cn } from '@/utils/cn'

/**
 * Popover — anchored panel of arbitrary content.
 *
 * Distinct from {@link Dropdown}, which implements the *menu* pattern: a list
 * of commands navigated with arrow keys. A popover holds a small interface —
 * the notification panel, a filter form — where Tab is the right way to move
 * and `role="menuitem"` would be a lie about what the content is.
 *
 * Non-modal: the page behind stays scrollable and is not hidden from assistive
 * tech. Focus still moves into the panel on open and returns to the trigger on
 * close, because a panel you cannot reach with the keyboard is not usable.
 */

export interface PopoverProps {
  /** Any focusable element; receives the ARIA wiring via cloneElement. */
  trigger: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>
  /** Content, or a render function receiving a `close` callback. */
  children: ReactNode | ((close: () => void) => ReactNode)
  /** Accessible name for the panel, e.g. "Notifications". */
  label: string
  align?: 'start' | 'end'
  className?: string
  /** Controlled open state. Omit for uncontrolled. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function Popover({
  trigger,
  children,
  label,
  align = 'end',
  className,
  open: controlledOpen,
  onOpenChange,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [flipped, setFlipped] = useState(false)
  /** Horizontal nudge that keeps a wide panel inside the viewport. */
  const [offsetX, setOffsetX] = useState(0)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const reduceMotion = useReducedMotion()

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  const close = useCallback(() => setOpen(false), [setOpen])

  useFocusTrap(panelRef, open)
  // The trigger is ignored so clicking it while open closes via its own handler
  // rather than closing here and immediately reopening.
  useDismiss(panelRef, close, { enabled: open, ignoreRefs: [triggerRef] })

  /**
   * Keep the panel on screen.
   *
   * Vertically: flip above the anchor when there isn't room below.
   *
   * Horizontally: a panel anchored to a trigger near the edge of a narrow
   * viewport runs off it — a 22rem notification panel hung off a bell icon at
   * 320px starts several rem to the left of the screen. Measuring and nudging
   * is what makes that survive a phone.
   */
  useLayoutEffect(() => {
    if (!open) {
      setFlipped(false)
      setOffsetX(0)
      return
    }

    const panel = panelRef.current
    const anchor = triggerRef.current
    if (!panel || !anchor) return

    const anchorRect = anchor.getBoundingClientRect()
    const spaceBelow = window.innerHeight - anchorRect.bottom
    const spaceAbove = anchorRect.top

    setFlipped(spaceBelow < panel.offsetHeight + 16 && spaceAbove > spaceBelow)

    // Measured with the current offset applied, so the correction is relative
    // rather than absolute — this stays correct if it runs twice.
    const panelRect = panel.getBoundingClientRect()
    const margin = 8

    let correction = 0
    if (panelRect.left < margin) {
      correction = margin - panelRect.left
    } else if (panelRect.right > window.innerWidth - margin) {
      correction = window.innerWidth - margin - panelRect.right
    }

    if (correction !== 0) setOffsetX((current) => current + correction)
  }, [open])

  const triggerElement = cloneElement(trigger, {
    ref: triggerRef,
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? panelId : undefined,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      trigger.props.onClick?.(event)
      setOpen(!open)
    },
  } as Partial<ButtonHTMLAttributes<HTMLButtonElement>> & { ref: typeof triggerRef })

  return (
    <div className="relative inline-flex">
      {triggerElement}

      <AnimatePresence>
        {open ? (
          /* Positioning lives on this wrapper and animation on the child.
             Framer Motion writes an inline `transform`, which would otherwise
             overwrite the viewport-clamping translate. (Tooltip splits them for
             the same reason.) */
          <div
            className={cn(
              'absolute z-40',
              flipped ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
              align === 'start' ? 'left-0' : 'right-0',
            )}
            style={offsetX === 0 ? undefined : { transform: `translateX(${offsetX}px)` }}
          >
            <motion.div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label={label}
              className={cn(
                'overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg',
                className,
              )}
              initial={
                reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: flipped ? 4 : -4 }
              }
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.14, ease: [0.25, 1, 0.5, 1] }}
            >
              {typeof children === 'function' ? children(close) : children}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
