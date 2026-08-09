import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Link } from 'react-router-dom'

import { HelpButton } from '@/components/layout/KeyboardShortcutsDialog'
import { Wordmark } from '@/components/layout/Logo'
import { SidebarNav } from '@/components/layout/SidebarNav'
import { WorkspaceSwitcher } from '@/components/navigation/WorkspaceSwitcher'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { primaryNavigation, secondaryNavigation } from '@/constants/navigation'
import { routes } from '@/constants/routes'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { useUiStore } from '@/store/uiStore'
import { shortcutLabel } from '@/utils/platform'
import { cn } from '@/utils/cn'

/**
 * Persistent sidebar — tablet and desktop. (CLAUDE.md §18, §27)
 *
 * Hidden below `md`, where {@link MobileNav} takes over with a drawer. It is
 * not merely a narrower version of this component: a drawer needs a focus trap,
 * an overlay and a scroll lock, none of which belong on a sidebar that is
 * simply always there.
 *
 * Collapsing to an icon rail is a persisted preference and is reachable both
 * from the toggle here and from ⌘B.
 */
export function Sidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const { workspace } = useActiveWorkspace()

  const workspaceId = workspace?.id ?? null

  return (
    <aside
      // `complementary` by default; the label distinguishes it from the topbar
      // for anyone navigating by landmark.
      aria-label="Sidebar"
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface md:flex',
        'transition-[width] duration-(--duration-normal) ease-(--ease-out-quart)',
        collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
      )}
    >
      {/* Brand + collapse control */}
      <div
        className={cn(
          'flex h-topbar shrink-0 items-center border-b border-border px-3',
          collapsed ? 'justify-center px-0' : 'justify-between',
        )}
      >
        <Link
          to={routes.app.dashboard}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <Wordmark markOnly={collapsed} />
        </Link>

        {!collapsed ? (
          <Tooltip content={`Collapse sidebar · ${shortcutLabel('B')}`} side="right">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleSidebar}
              aria-label="Collapse sidebar"
              aria-expanded
            >
              <PanelLeftClose aria-hidden="true" />
            </Button>
          </Tooltip>
        ) : null}
      </div>

      <div className={cn('flex min-h-0 flex-1 flex-col gap-1 py-3', collapsed ? 'px-2' : 'px-3')}>
        <WorkspaceSwitcher collapsed={collapsed} />

        <SidebarNav
          label="Main"
          items={primaryNavigation}
          workspaceId={workspaceId}
          collapsed={collapsed}
          className="mt-2 min-h-0 flex-1 overflow-y-auto"
        />

        {/* Reference and configuration, pinned to the bottom. (§27) */}
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
          <SidebarNav
            label="Workspace"
            items={secondaryNavigation}
            workspaceId={workspaceId}
            collapsed={collapsed}
          />

          <HelpButton collapsed={collapsed} />

          {collapsed ? (
            <Tooltip content={`Expand sidebar · ${shortcutLabel('B')}`} side="right">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                aria-label="Expand sidebar"
                aria-expanded={false}
                className="mx-auto"
              >
                <PanelLeftOpen aria-hidden="true" />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
