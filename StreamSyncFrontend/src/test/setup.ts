import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

/**
 * Test environment setup.
 *
 * jsdom implements the DOM but not the browser around it. Each shim below
 * exists because a component this app actually ships would otherwise throw
 * rather than fail an assertion — a crash tells you nothing about the
 * behaviour you were trying to test.
 */

/* matchMedia — used by the theme store, useMediaQuery, and Framer Motion's
   useReducedMotion. Defaults to "does not match", so tests run in the light
   theme, at desktop width, with motion enabled unless a test says otherwise. */
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  })
}

/** Sets the result of a media query for the current test. */
export function setMatchMedia(matcher: (query: string) => boolean): void {
  const listeners = new Set<() => void>()

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: matcher(query),
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  })
}

/* scrollIntoView — the command menu keeps the highlighted option in view. */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined
}

/* ResizeObserver — not used directly, but Framer Motion reaches for it. */
if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  })
}

/* crypto.randomUUID / crypto.subtle — the toast store and the mock auth
   service depend on both, and Vitest's jsdom environment exposes Node's Web
   Crypto for them. Asserted rather than polyfilled: importing node:crypto here
   would pull Node's global types into the application's type environment
   (tsconfig.app.json deliberately ships only "vite/client"), which is how app
   code ends up quietly depending on `process`. */
if (!globalThis.crypto?.randomUUID || !globalThis.crypto?.subtle) {
  throw new Error(
    'Web Crypto is unavailable in this test environment. StreamSync needs ' +
      'crypto.randomUUID and crypto.subtle; check the Vitest environment and Node version.',
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  window.localStorage.clear()
  window.sessionStorage.clear()
})
