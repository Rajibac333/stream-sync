import { useEffect } from 'react'

import { useUiStore } from '@/store/uiStore'
import { hasCommandModifier } from '@/utils/platform'

/**
 * Application-wide keyboard shortcuts. (CLAUDE.md §30)
 *
 * Registered once by the app shell rather than by the components they act on,
 * so the handlers exist regardless of what is currently mounted and there is
 * exactly one listener rather than one per consumer.
 *
 * Every shortcut here is modifier-based on purpose. Bare-letter shortcuts —
 * `/` to search, `g` then `d` to navigate — collide with typing the moment
 * focus is anywhere unexpected, and Milestone 5 puts a rich-text editor at the
 * centre of this app.
 */
export function useGlobalShortcuts(): void {
  const toggleCommandMenu = useUiStore((state) => state.toggleCommandMenu)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!hasCommandModifier(event) || event.altKey) return

      // `event.key` respects the active layout, so this stays correct on an
      // AZERTY or Dvorak keyboard where `code` would not.
      switch (event.key.toLowerCase()) {
        case 'k':
          // Beats the browser's own ⌘K (focus address bar) — which is the
          // established convention for a command palette, and the reason users
          // reach for it here in the first place.
          event.preventDefault()
          toggleCommandMenu()
          break
        case 'b':
          event.preventDefault()
          toggleSidebar()
          break
        default:
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [toggleCommandMenu, toggleSidebar])
}
