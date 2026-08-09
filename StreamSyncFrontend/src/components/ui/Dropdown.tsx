import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { useDismiss } from '@/hooks/useDismiss'
import { cn } from '@/utils/cn'

/**
 * Dropdown menu — WAI-ARIA menu button pattern.
 *
 * Implements the keyboard contract users of a menu actually expect:
 *
 *   ↓ / ↑          move between items, wrapping at the ends
 *   Home / End     first / last item
 *   Enter / Space  activate
 *   Escape         close and return focus to the trigger
 *   ↓ on trigger   open with the first item focused
 *   ↑ on trigger   open with the last item focused
 *
 * Focus is *moved* between items rather than tracked with aria-activedescendant,
 * which keeps each item a real focusable button and keeps behaviour correct if
 * items are added or removed while the menu is open.
 *
 * POSITIONING
 *
 * The menu is portalled to <body> and positioned with `fixed` coordinates
 * measured from the trigger, rather than absolutely inside it.
 *
 * That is not a refactor for its own sake. An absolutely-positioned menu is
 * clipped by the nearest scrolling ancestor, and two of this app's menus live
 * inside one: the Kanban card's "Move to" menu sits in the board's horizontal
 * scroller below `lg`, and the workspace switcher sits in the mobile drawer's
 * scroll area. Both were cut off on exactly the viewports where dragging is
 * hardest and the menu is the only way to do the job.
 */

interface DropdownProps {
  /** Any focusable element; receives the menu-button ARIA props via cloneElement. */
  trigger: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>
  children: ReactNode
  align?: 'start' | 'end'
  side?: 'bottom' | 'top'
  /** Accessible name for the menu itself, e.g. "Document actions". */
  label?: string
  className?: string
}

function getMenuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'))
}

/** Viewport coordinates for the portalled menu. */
interface MenuPosition {
  top: number
  left: number
  /** Below which the menu scrolls internally rather than leaving the viewport. */
  maxHeight: number
  placement: 'bottom' | 'top'
}

const GAP = 4
const MARGIN = 8

export function Dropdown({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  label,
  className,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const reduceMotion = useReducedMotion()

  const close = useCallback((returnFocus = true) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  // Outside-click closes without stealing focus back; that would yank the
  // caret away from wherever the user just clicked.
  useDismiss(menuRef, () => close(false), {
    enabled: open,
    ignoreRefs: [triggerRef],
    // Escape is handled below rather than here, because it is the one dismissal
    // that *should* return focus to the trigger.
    closeOnEscape: false,
  })

  /**
   * Escape closes the menu from anywhere, not only from inside it.
   *
   * The menu's own key handler only fires once focus is in the list, which is
   * true after ↓ from the trigger but not after a click — so a menu opened with
   * the mouse could not be dismissed from the keyboard at all. Listening on the
   * document covers both; the menu's handler stops propagation, so a keystroke
   * it has already dealt with never reaches here twice.
   */
  useEffect(() => {
    if (!open) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, close])

  const openAndFocus = useCallback((position: 'first' | 'last') => {
    setOpen(true)
    requestAnimationFrame(() => {
      const menu = menuRef.current
      if (!menu) return
      const items = getMenuItems(menu)
      const target = position === 'first' ? items[0] : items[items.length - 1]
      target?.focus()
    })
  }, [])

  /**
   * Measures the trigger and places the menu against it.
   *
   * Runs in a layout effect so the corrected position is committed before the
   * browser paints — a first frame at (0,0) followed by a jump is worse than
   * the clipping this replaced.
   */
  const reposition = useCallback(() => {
    const menu = menuRef.current
    const anchor = triggerRef.current
    if (!menu || !anchor) return

    const rect = anchor.getBoundingClientRect()
    const { innerWidth, innerHeight } = window
    const width = menu.offsetWidth
    const height = menu.offsetHeight

    const spaceBelow = innerHeight - rect.bottom - GAP - MARGIN
    const spaceAbove = rect.top - GAP - MARGIN

    // Flip only when there is genuinely more room the other way.
    const placement: 'bottom' | 'top' =
      side === 'bottom'
        ? height > spaceBelow && spaceAbove > spaceBelow
          ? 'top'
          : 'bottom'
        : height > spaceAbove && spaceBelow > spaceAbove
          ? 'bottom'
          : 'top'

    const top = placement === 'bottom' ? rect.bottom + GAP : Math.max(MARGIN, rect.top - GAP - height)

    // Clamped into the viewport, so a trigger near either edge still yields a
    // fully visible menu at 320px.
    const preferredLeft = align === 'start' ? rect.left : rect.right - width
    const left = Math.min(Math.max(MARGIN, preferredLeft), Math.max(MARGIN, innerWidth - width - MARGIN))

    setPosition({
      top,
      left,
      maxHeight: Math.max(120, placement === 'bottom' ? spaceBelow : spaceAbove),
      placement,
    })
  }, [align, side])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    reposition()
  }, [open, reposition])

  /* A fixed menu does not travel with its trigger, so anything that moves the
     trigger has to re-place it. Capture phase catches scrolling inside the
     board and the drawer, not just the window. */
  useEffect(() => {
    if (!open) return

    const handle = () => reposition()
    window.addEventListener('resize', handle)
    window.addEventListener('scroll', handle, true)

    return () => {
      window.removeEventListener('resize', handle)
      window.removeEventListener('scroll', handle, true)
    }
  }, [open, reposition])

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      openAndFocus('first')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openAndFocus('last')
    }
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current
    if (!menu) return

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }

    if (event.key === 'Tab') {
      // Tab out of a menu closes it — the menu is not a tab stop sequence.
      close(false)
      return
    }

    const items = getMenuItems(menu)
    if (items.length === 0) return

    const currentIndex = items.findIndex((item) => item === document.activeElement)

    const focusAt = (index: number) => {
      event.preventDefault()
      const wrapped = (index + items.length) % items.length
      items[wrapped]?.focus()
    }

    switch (event.key) {
      case 'ArrowDown':
        focusAt(currentIndex + 1)
        break
      case 'ArrowUp':
        focusAt(currentIndex - 1)
        break
      case 'Home':
        focusAt(0)
        break
      case 'End':
        focusAt(items.length - 1)
        break
      default:
        break
    }
  }

  const triggerElement = cloneElement(trigger, {
    ref: triggerRef,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      trigger.props.onClick?.(event)
      setOpen((previous) => !previous)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      trigger.props.onKeyDown?.(event)
      handleTriggerKeyDown(event)
    },
  } as Partial<ButtonHTMLAttributes<HTMLButtonElement>> & { ref: typeof triggerRef })

  const placement = position?.placement ?? side

  const menu = (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          aria-orientation="vertical"
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          // Click bubbling up from an item closes the menu, so individual
          // items don't each have to remember to.
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('[role="menuitem"]')) close()
          }}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            maxHeight: position?.maxHeight,
            // Hidden for the one frame before measurement, so the menu is never
            // seen in the top-left corner.
            visibility: position ? 'visible' : 'hidden',
          }}
          className={cn(
            // z-50 rather than z-40: portalled to <body>, this has to clear the
            // mobile drawer and any dialog it was opened from.
            'fixed z-50 min-w-48 overflow-y-auto rounded-lg border border-border',
            'bg-surface-raised p-1 shadow-lg',
            className,
          )}
          initial={
            reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, scale: 0.97, y: placement === 'bottom' ? -4 : 4 }
          }
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.12, ease: [0.25, 1, 0.5, 1] }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )

  return (
    <div className="relative inline-flex">
      {triggerElement}
      {createPortal(menu, document.body)}
    </div>
  )
}

export interface DropdownItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon?: ReactNode
  /** Right-aligned hint, e.g. a keyboard shortcut. */
  shortcut?: string
  variant?: 'default' | 'danger'
}

export function DropdownItem({
  className,
  icon,
  shortcut,
  variant = 'default',
  children,
  disabled,
  onClick,
  ...props
}: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      // aria-disabled rather than `disabled`: a disabled button is skipped by
      // arrow-key navigation entirely, which hides the option's existence.
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-body',
        'transition-colors duration-(--duration-instant)',
        'outline-none focus-visible:bg-surface-hover',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        variant === 'default' && 'text-foreground hover:bg-surface-hover',
        variant === 'danger' && 'text-danger hover:bg-danger-subtle focus-visible:bg-danger-subtle',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      {...props}
    >
      {icon ? <span className="text-foreground-subtle">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? (
        <span className="shrink-0 text-caption text-foreground-subtle" aria-hidden="true">
          {shortcut}
        </span>
      ) : null}
    </button>
  )
}

export function DropdownSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

export function DropdownLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-2 py-1.5 text-caption font-medium text-foreground-subtle', className)}
      {...props}
    />
  )
}
