import { useEffect, useRef, type RefObject } from 'react'

/**
 * Confines Tab focus to a container and restores it on close.
 *
 * Required for anything modal (CLAUDE.md §19). Without this a keyboard user
 * tabs straight out of an open dialog and into the page behind it, which they
 * cannot see and which a screen reader has been told is hidden.
 *
 * Deliberately queries focusable children on every Tab rather than caching
 * them: dialog content is dynamic (a form revealing a field, a list loading in)
 * and a stale list would trap focus on a node that no longer exists.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      // offsetParent is null for display:none subtrees; the rect check catches
      // visibility:hidden and zero-size elements that offsetParent misses.
      (element.offsetParent !== null || element.getClientRects().length > 0),
  )
}

interface FocusTrapOptions {
  /** Focus this instead of the first focusable child (e.g. a destructive-action dialog's Cancel). */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Skip returning focus — useful when the trigger is being unmounted anyway. */
  returnFocus?: boolean
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  options: FocusTrapOptions = {},
): void {
  const { initialFocusRef, returnFocus = true } = options
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    // Defer one frame so the element exists and any entrance animation has
    // started; focusing a mid-transition node scrolls the page in some browsers.
    const frame = requestAnimationFrame(() => {
      const target = initialFocusRef?.current ?? getFocusableElements(container)[0] ?? container
      if (target === container && !container.hasAttribute('tabindex')) {
        container.setAttribute('tabindex', '-1')
      }
      target.focus({ preventScroll: true })
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return

      const focusable = getFocusableElements(container)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      const activeElement = document.activeElement

      // Focus escaped the container entirely (e.g. it was on a node that just
      // unmounted) — pull it back to an edge rather than letting Tab leak.
      if (!(activeElement instanceof HTMLElement) || !container.contains(activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }

      if (event.shiftKey && activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown, true)

      if (returnFocus && previouslyFocused.current?.isConnected) {
        previouslyFocused.current.focus({ preventScroll: true })
      }
    }
  }, [active, containerRef, initialFocusRef, returnFocus])
}
