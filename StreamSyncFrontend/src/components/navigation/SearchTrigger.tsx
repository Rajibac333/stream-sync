import { Search } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { useUiStore } from '@/store/uiStore'
import { shortcutLabel } from '@/utils/platform'
import { cn } from '@/utils/cn'

/**
 * Global search entry point. (CLAUDE.md §29, §46)
 *
 * Opens the command menu rather than being a second, separate search field.
 * One search surface means one set of results, one keyboard model, and one
 * place to fix when ranking changes.
 *
 * It looks like an input but is a <button>: it opens a dialog, and typing here
 * would go nowhere. Announcing it as a text field would be a lie a screen
 * reader user only discovers after trying to type into it.
 */
export function SearchTrigger({ className }: { className?: string }) {
  const openCommandMenu = useUiStore((state) => state.setCommandMenuOpen)
  const open = () => openCommandMenu(true)

  return (
    <>
      {/* Tablet and up: a wide affordance that advertises the shortcut. */}
      <button
        type="button"
        onClick={open}
        className={cn(
          'hidden h-8 w-full max-w-72 items-center gap-2 rounded-md border border-border bg-surface px-2.5 sm:flex',
          'text-body text-foreground-subtle',
          'transition-[border-color,background-color] duration-(--duration-fast) ease-(--ease-out-quart)',
          'hover:border-border-strong hover:bg-surface-hover',
          'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
          'focus-visible:ring-offset-background',
          className,
        )}
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">Search…</span>
        <kbd
          className="shrink-0 rounded-xs border border-border bg-surface-muted px-1.5 py-px font-sans text-caption text-foreground-subtle"
          aria-hidden="true"
        >
          {shortcutLabel('K')}
        </kbd>
      </button>

      {/* Phones: there is no room for a search bar next to the breadcrumbs. */}
      <Tooltip content={`Search · ${shortcutLabel('K')}`}>
        <Button variant="ghost" size="icon" onClick={open} aria-label="Search" className="sm:hidden">
          <Search aria-hidden="true" />
        </Button>
      </Tooltip>
    </>
  )
}
