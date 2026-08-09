import { useThemeStore, type ResolvedTheme, type ThemePreference } from '@/store/themeStore'

interface UseThemeResult {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
  toggle: () => void
}

/** Component-facing view of the theme store. */
export function useTheme(): UseThemeResult {
  const preference = useThemeStore((state) => state.preference)
  const resolved = useThemeStore((state) => state.resolved)
  const setPreference = useThemeStore((state) => state.setPreference)
  const toggle = useThemeStore((state) => state.toggle)

  return { preference, resolved, setPreference, toggle }
}
