import { Check, Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Dropdown, DropdownItem, DropdownLabel } from '@/components/ui/Dropdown'
import { useTheme } from '@/hooks/useTheme'
import type { ThemePreference } from '@/store/themeStore'

/**
 * Theme switcher.
 *
 * Offers Light / Dark / System rather than a binary toggle — "System" is the
 * setting most users actually want, and a two-state switch silently overrides
 * their OS preference forever after one click. (CLAUDE.md §17)
 */

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme()
  const ActiveIcon = resolved === 'dark' ? Moon : Sun

  return (
    <Dropdown
      align="end"
      label="Theme"
      // Not wrapped in a Tooltip: Dropdown clones its trigger to attach the ref
      // and menu ARIA, which a wrapper component would swallow. The aria-label
      // is the accessible name either way.
      trigger={
        <Button variant="ghost" size="icon" aria-label={`Theme: ${preference}. Change theme`}>
          <ActiveIcon aria-hidden="true" />
        </Button>
      }
    >
      <DropdownLabel>Appearance</DropdownLabel>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <DropdownItem
          key={value}
          icon={<Icon aria-hidden="true" />}
          onClick={() => setPreference(value)}
        >
          <span className="flex items-center justify-between gap-2">
            {label}
            {preference === value ? <Check className="size-3.5 text-primary" aria-hidden="true" /> : null}
          </span>
        </DropdownItem>
      ))}
    </Dropdown>
  )
}
