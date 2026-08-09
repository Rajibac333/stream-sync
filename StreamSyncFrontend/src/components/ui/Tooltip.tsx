import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { cloneElement, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { HTMLAttributes, ReactElement, ReactNode } from 'react'

import { cn } from '@/utils/cn'

/**
 * Tooltip
 *
 * Supplementary information only. A tooltip is never the sole accessible name
 * for a control — an icon button still carries its own `aria-label`, because
 * tooltips are unreachable on touch and inconsistently announced. This one is
 * wired with `aria-describedby`, i.e. *description*, not *name*.
 *
 * Shows on hover **and on focus**, so keyboard users get the same information
 * pointer users do, and dismisses on Escape per WCAG 1.4.13.
 */

const OPEN_DELAY_MS = 400
const CLOSE_DELAY_MS = 100

export interface TooltipProps {
  /** The trigger. Must accept a ref and spread DOM props. */
  children: ReactElement<HTMLAttributes<HTMLElement>>
  content: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Skip the open delay — for tooltips on a toolbar the user is scanning. */
  instant?: boolean
  /** Escape hatch for triggers that already say everything they need to. */
  disabled?: boolean
}

const SIDE_CLASSES = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
} as const

const SIDE_OFFSETS = {
  top: { y: 3 },
  bottom: { y: -3 },
  left: { x: 3 },
  right: { x: -3 },
} as const

export function Tooltip({
  children,
  content,
  side = 'top',
  instant = false,
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tooltipId = useId()
  const reduceMotion = useReducedMotion()

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current)
  }, [])

  const show = useCallback(
    (immediate: boolean) => {
      clearTimer()
      if (immediate) {
        setOpen(true)
        return
      }
      timerRef.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS)
    },
    [clearTimer],
  )

  const hide = useCallback(
    (immediate: boolean) => {
      clearTimer()
      if (immediate) {
        setOpen(false)
        return
      }
      timerRef.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
    },
    [clearTimer],
  )

  useEffect(() => clearTimer, [clearTimer])

  // WCAG 1.4.13: content shown on hover must be dismissible without moving the
  // pointer, because it can cover what the user was trying to read.
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide(true)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, hide])

  if (disabled) return children

  const trigger = cloneElement(children, {
    'aria-describedby': open ? tooltipId : undefined,
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      children.props.onMouseEnter?.(event)
      show(instant)
    },
    onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
      children.props.onMouseLeave?.(event)
      hide(false)
    },
    // Focus, not focus-within: keyboard users get the tooltip too.
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      children.props.onFocus?.(event)
      show(true)
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      children.props.onBlur?.(event)
      hide(true)
    },
  } as Partial<HTMLAttributes<HTMLElement>> & { 'aria-describedby'?: string })

  return (
    <span className="relative inline-flex">
      {trigger}

      <AnimatePresence>
        {open ? (
          // Positioning lives on this wrapper and animation on the child:
          // Framer writes an inline `transform`, which would otherwise clobber
          // the `-translate-x-1/2` doing the centering.
          <span
            className={cn('pointer-events-none absolute z-50 w-max', SIDE_CLASSES[side])}
          >
            <motion.span
              id={tooltipId}
              role="tooltip"
              className="block max-w-56 rounded-md bg-foreground px-2 py-1 text-caption text-background shadow-md"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, ...SIDE_OFFSETS[side] }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0 }}
              transition={
                reduceMotion ? { duration: 0 } : { duration: 0.12, ease: [0.25, 1, 0.5, 1] }
              }
            >
              {content}
            </motion.span>
          </span>
        ) : null}
      </AnimatePresence>
    </span>
  )
}
