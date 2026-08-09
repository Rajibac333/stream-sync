import { Menu } from 'lucide-react'

import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { NotificationsMenu } from '@/components/notifications/NotificationsMenu'
import { SearchTrigger } from '@/components/navigation/SearchTrigger'
import { UserMenu } from '@/components/navigation/UserMenu'
import { Button } from '@/components/ui/Button'
import { useUiStore } from '@/store/uiStore'

/**
 * Application topbar. (CLAUDE.md §29)
 *
 * Left: the menu button (phones only) and breadcrumbs.
 * Centre: global search, which collapses to an icon below `sm`.
 * Right: notifications, theme, profile.
 *
 * Sticky rather than fixed, so it participates in the document flow and the
 * content below never needs a magic top offset to clear it.
 */
export function Topbar() {
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)

  return (
    <header
      className="sticky top-0 z-30 flex h-topbar shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-sm sm:px-4"
    >
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open navigation"
        // The drawer it opens is a modal dialog, and saying so lets a screen
        // reader warn the user before they land in one.
        aria-haspopup="dialog"
      >
        <Menu aria-hidden="true" />
      </Button>

      <Breadcrumbs className="flex-1 sm:flex-none" />

      {/* Pushes search to the centre on wide screens and collapses to nothing
          on narrow ones, without a media query. */}
      <div className="ml-auto flex flex-1 justify-end sm:justify-center">
        <SearchTrigger />
      </div>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <NotificationsMenu />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  )
}
