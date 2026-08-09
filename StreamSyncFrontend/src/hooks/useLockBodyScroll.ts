import { useEffect } from 'react'

/**
 * Prevents the page behind a modal from scrolling.
 *
 * Reference-counted, because overlays nest: a dropdown opened inside a dialog
 * must not release the dialog's lock when it closes.
 *
 * The scrollbar's width is compensated with padding — without it, hiding
 * overflow reflows the entire layout a few pixels wider the instant a dialog
 * opens, which reads as a flinch.
 */

let lockCount = 0
let restore: (() => void) | null = null

export function useLockBodyScroll(active: boolean): void {
  useEffect(() => {
    if (!active) return

    lockCount += 1

    if (lockCount === 1) {
      const { body, documentElement } = document
      const previousOverflow = body.style.overflow
      const previousPaddingRight = body.style.paddingRight

      const scrollbarWidth = window.innerWidth - documentElement.clientWidth
      body.style.overflow = 'hidden'
      if (scrollbarWidth > 0) {
        const current = Number.parseFloat(getComputedStyle(body).paddingRight) || 0
        body.style.paddingRight = `${current + scrollbarWidth}px`
      }

      restore = () => {
        body.style.overflow = previousOverflow
        body.style.paddingRight = previousPaddingRight
      }
    }

    return () => {
      lockCount -= 1
      if (lockCount === 0) {
        restore?.()
        restore = null
      }
    }
  }, [active])
}
