import { useEffect, type RefObject } from 'react'

/**
 * Escape-to-close and click-outside-to-close for overlays.
 *
 * Two details that are easy to get wrong and are handled here:
 *
 *  1. Outside clicks listen on `pointerdown`, not `click`. With `click`, an
 *     interaction that unmounts the element between mousedown and mouseup
 *     (dragging out of a dropdown, text selection ending outside a popover)
 *     never dismisses.
 *
 *  2. Escape is captured on the document so the *topmost* overlay wins — a
 *     dropdown inside a dialog must close the dropdown, not the dialog. Callers
 *     pass `enabled: false` while a child overlay is open.
 */

interface DismissOptions {
  enabled?: boolean
  /** Clicks inside any of these are treated as inside (e.g. the trigger button). */
  ignoreRefs?: readonly RefObject<HTMLElement | null>[]
  closeOnEscape?: boolean
  closeOnOutsidePointerDown?: boolean
}

export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  options: DismissOptions = {},
): void {
  const {
    enabled = true,
    ignoreRefs,
    closeOnEscape = true,
    closeOnOutsidePointerDown = true,
  } = options

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!closeOnEscape || event.key !== 'Escape') return
      event.stopPropagation()
      onDismiss()
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!closeOnOutsidePointerDown) return
      const target = event.target
      if (!(target instanceof Node)) return

      if (ref.current?.contains(target)) return
      if (ignoreRefs?.some((ignored) => ignored.current?.contains(target))) return

      onDismiss()
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [enabled, ref, ignoreRefs, onDismiss, closeOnEscape, closeOnOutsidePointerDown])
}
