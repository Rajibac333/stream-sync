import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '@/components/ui/Dropdown'
import { Skeleton } from '@/components/ui/Skeleton'
import { routes } from '@/constants/routes'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { useUiStore } from '@/store/uiStore'
import type { Workspace } from '@/types/workspace'
import { cn } from '@/utils/cn'

/**
 * Workspace switcher. (CLAUDE.md §28)
 *
 * Shows the current workspace, switches between them, and offers to create one.
 * Switching navigates to that workspace's project list rather than staying on
 * the current path — /projects/abc means nothing in a different workspace, and
 * carrying the path over produces a 404 the user didn't ask for.
 */

/** Initials tile — the same treatment as an avatar, squared off for an org. */
function WorkspaceGlyph({ workspace, className }: { workspace: Workspace; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-caption font-semibold text-primary-foreground',
        className,
      )}
    >
      {workspace.name.charAt(0).toUpperCase()}
    </span>
  )
}

export interface WorkspaceSwitcherProps {
  /** Icon-only, for the collapsed sidebar rail. */
  collapsed?: boolean
  className?: string
}

export function WorkspaceSwitcher({ collapsed = false, className }: WorkspaceSwitcherProps) {
  const navigate = useNavigate()
  const openCreateDialog = useUiStore((state) => state.openCreateDialog)
  const { workspace, workspaces, isLoading } = useActiveWorkspace()

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2 px-1', className)} aria-busy="true">
        <Skeleton className="size-6 shrink-0" />
        {!collapsed ? <Skeleton shape="text" className="h-3.5 flex-1" /> : null}
        <span className="sr-only" role="status">
          Loading workspaces
        </span>
      </div>
    )
  }

  /* A brand-new account belongs to nothing yet — the state every real first
     sign-in starts in, and one the mock data never produces because it seeds a
     workspace. This has to be the way *out* of that state: rendering dead text
     here leaves the user with a disabled sidebar and no path forward. */
  if (!workspace) {
    return (
      <button
        type="button"
        onClick={() => openCreateDialog({ kind: 'workspace' })}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-md px-1.5 text-left',
          'transition-colors duration-(--duration-fast) hover:bg-surface-hover',
          'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1',
          'focus-visible:ring-offset-background',
          collapsed && 'justify-center px-0',
          className,
        )}
        aria-label="Create your first workspace"
      >
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-foreground-subtle"
        >
          <Plus className="size-3.5" />
        </span>

        {!collapsed ? (
          <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
            Create workspace
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <Dropdown
      align="start"
      label="Switch workspace"
      className="w-64"
      trigger={
        <button
          type="button"
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-md px-1.5 text-left',
            'transition-colors duration-(--duration-fast) hover:bg-surface-hover',
            'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1',
            'focus-visible:ring-offset-background',
            collapsed && 'justify-center px-0',
            className,
          )}
          // The visible text is the workspace name alone; the accessible name
          // has to say what pressing this does.
          aria-label={`Workspace: ${workspace.name}. Switch workspace`}
        >
          <WorkspaceGlyph workspace={workspace} />

          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                {workspace.name}
              </span>
              <ChevronsUpDown
                className="size-3.5 shrink-0 text-foreground-subtle"
                aria-hidden="true"
              />
            </>
          ) : null}
        </button>
      }
    >
      <DropdownLabel>Workspaces</DropdownLabel>

      {workspaces.map((candidate) => (
        <DropdownItem
          key={candidate.id}
          icon={<WorkspaceGlyph workspace={candidate} className="size-5 text-[0.625rem]" />}
          onClick={() => navigate(routes.workspace.projects(candidate.id))}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate">{candidate.name}</span>

            <span className="flex shrink-0 items-center gap-1.5">
              <Badge size="sm" variant="outline" className="capitalize">
                {candidate.role}
              </Badge>
              {candidate.id === workspace.id ? (
                <Check className="size-3.5 text-primary" aria-hidden="true" />
              ) : null}
            </span>
          </span>
        </DropdownItem>
      ))}

      <DropdownSeparator />

      <DropdownItem
        icon={<Plus aria-hidden="true" />}
        onClick={() => openCreateDialog({ kind: 'workspace' })}
      >
        Create workspace
      </DropdownItem>
    </Dropdown>
  )
}
