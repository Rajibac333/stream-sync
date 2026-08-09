import { create } from 'zustand'

/**
 * Theme preference.
 *
 * Persistence is hand-rolled rather than `zustand/middleware/persist` for one
 * reason: the blocking script in index.html has to read this value before any
 * JavaScript module loads, so the stored format must stay a plain string
 * (`"dark"`), not persist's `{"state":{...},"version":0}` envelope.
 *
 * STORAGE_KEY and the accepted values are mirrored in index.html.
 * CLAUDE.md §17
 */

const STORAGE_KEY = 'streamsync-theme'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeState {
  /** What the user chose. */
  preference: ThemePreference
  /** What is actually painted — `preference`, with `system` resolved. */
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
  toggle: () => void
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    // Safari private mode throws on localStorage. Not worth breaking boot over.
    return 'system'
  }
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return prefersDark() ? 'dark' : 'light'
  return preference
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved)
}

const initialPreference = readStoredPreference()

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: initialPreference,
  resolved: resolveTheme(initialPreference),

  setPreference: (preference) => {
    const resolved = resolveTheme(preference)
    try {
      localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // Preference simply won't survive the session. Theme still applies.
    }
    applyTheme(resolved)
    set({ preference, resolved })
  },

  // Toggling from `system` commits to the opposite of what's on screen, which
  // is what a user pressing a light/dark switch actually expects.
  toggle: () => {
    get().setPreference(get().resolved === 'dark' ? 'light' : 'dark')
  },
}))

/**
 * Keeps a `system` preference in sync when the OS flips appearance mid-session.
 * Called once from main.tsx; returns an unsubscribe for completeness.
 */
export function initThemeSync(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')

  const handleChange = () => {
    const { preference } = useThemeStore.getState()
    if (preference !== 'system') return
    const resolved = resolveTheme('system')
    applyTheme(resolved)
    useThemeStore.setState({ resolved })
  }

  media.addEventListener('change', handleChange)
  // Re-assert on boot: the inline script and the store must not disagree.
  applyTheme(useThemeStore.getState().resolved)

  return () => media.removeEventListener('change', handleChange)
}
