import { Link, useLocation } from 'react-router-dom'

import { Tooltip } from '@/components/ui/Tooltip'
import { isNavItemActive, type NavItem } from '@/constants/navigation'
import { cn } from '@/utils/cn'

/**
 * Sidebar navigation list.
 *
 * Shared by the persistent desktop sidebar and the mobile drawer so the two can
 * never drift apart. Renders a real <ul> of <a> elements — navigation is links,
 * and a screen-reader user should be told how many there are and be able to
 * jump the list. (CLAUDE.md §19, §27)
 */

export interface SidebarNavProps {
  items: readonly NavItem[]
  /** Null while workspaces are still loading — scoped items are inert. */
  workspaceId: string | null
  /** Icon-only rail. Labels move into tooltips and stay in the a11y tree. */
  collapsed?: boolean
  /** Closes the drawer after a mobile selection. */
  onNavigate?: () => void
  /** Accessible name, e.g. "Main". Required — two <nav>s must be tellable apart. */
  label: string
  className?: string
}

const ITEM_BASE = [
  'group relative flex h-8 items-center gap-2.5 rounded-md text-body',
  'transition-[background-color,color] duration-(--duration-fast) ease-(--ease-out-quart)',
  'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1',
  'focus-visible:ring-offset-background',
  '[&_svg]:size-4 [&_svg]:shrink-0',
].join(' ')

export function SidebarNav({
  items,
  workspaceId,
  collapsed = false,
  onNavigate,
  label,
  className,
}: SidebarNavProps) {
  const { pathname } = useLocation()

  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon
          const unavailable = item.requiresWorkspace && workspaceId === null
          const active = !unavailable && isNavItemActive(item, pathname, workspaceId ?? '')

          const content = (
            <>
              <Icon
                aria-hidden="true"
                className={cn(
                  'shrink-0 transition-colors duration-(--duration-fast)',
                  active ? 'text-primary' : 'text-foreground-subtle group-hover:text-foreground-muted',
                )}
              />
              <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
            </>
          )

          /* A scoped destination with no workspace yet is not a link — there is
             nowhere for it to point. Rendering it as an <a href="#"> would be a
             broken promise; `aria-disabled` on a non-link states the truth. */
          if (unavailable) {
            return (
              <li key={item.id}>
                <span
                  aria-disabled="true"
                  className={cn(
                    ITEM_BASE,
                    'cursor-default px-2 text-foreground-subtle opacity-50',
                    collapsed && 'justify-center px-0',
                  )}
                >
                  {content}
                </span>
              </li>
            )
          }

          const link = (
            <Link
              to={item.to(workspaceId ?? '')}
              onClick={onNavigate}
              // `page`, not `true`: this identifies the current page within the
              // set, which is what a screen reader announces.
              aria-current={active ? 'page' : undefined}
              className={cn(
                ITEM_BASE,
                'px-2',
                active
                  ? 'bg-primary-subtle font-medium text-primary-subtle-foreground'
                  : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                collapsed && 'justify-center px-0',
              )}
            >
              {content}
            </Link>
          )

          return (
            <li key={item.id}>
              {collapsed ? (
                <Tooltip content={item.label} side="right" instant>
                  {link}
                </Tooltip>
              ) : (
                link
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
