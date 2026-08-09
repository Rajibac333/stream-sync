import { useSyncExternalStore } from 'react'

/**
 * Subscribes to a CSS media query.
 *
 * Built on `useSyncExternalStore` rather than useState + useEffect so the very
 * first render already knows the answer. With an effect, every mount renders
 * once at the wrong breakpoint and then corrects itself — which on the app
 * shell means the mobile drawer markup flashes on a desktop load.
 *
 * Layout should be CSS wherever it can be. Reach for this only when the
 * *behaviour* differs — the sidebar is a persistent aside on desktop and a
 * focus-trapped drawer on mobile, which is a different component, not a
 * different width. (CLAUDE.md §18)
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (onChange: () => void): (() => void) => {
    const media = window.matchMedia(query)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // Server snapshot: no viewport exists during prerender, so assume the
    // desktop layout and let hydration correct it.
    () => true,
  )
}

/** Breakpoints, matching the Tailwind scale used across the shell. */
export const BREAKPOINTS = {
  /** ≥ 768px — tablet and up. Below this the sidebar becomes a drawer. */
  tablet: '(min-width: 48rem)',
  /** ≥ 1024px — desktop. Sidebar is persistent and expanded by default. */
  desktop: '(min-width: 64rem)',
} as const

export function useIsDesktop(): boolean {
  return useMediaQuery(BREAKPOINTS.desktop)
}

export function useIsTabletUp(): boolean {
  return useMediaQuery(BREAKPOINTS.tablet)
}
