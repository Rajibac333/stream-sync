import { FilePlus, FolderPlus, SquarePen, UserPlus, type LucideIcon } from 'lucide-react'

import { toast } from '@/store/toastStore'
import { useUiStore, type CreateDialogState } from '@/store/uiStore'
import { cn } from '@/utils/cn'

/**
 * Quick actions.
 *
 * The four entry points a workspace page needs. The screens that perform them
 * belong to Milestones 4 and 7, so each says where it lands rather than being a
 * dead control (Rule 10) — the affordance, layout and keyboard behaviour are
 * real, and swapping a toast for a dialog is a one-line change per action.
 */

interface QuickAction {
  id: string
  label: string
  description: string
  icon: LucideIcon
  /** What pressing it opens. Absent means the feature is genuinely not built. */
  opens?: CreateDialogState
  /** Marks an action whose screen is not built. Renders an honest toast. */
  milestone?: number
}

const ACTIONS: readonly QuickAction[] = [
  {
    id: 'project',
    label: 'New project',
    description: 'Group work and track progress',
    icon: FolderPlus,
    opens: { kind: 'project' },
  },
  {
    id: 'document',
    label: 'New document',
    description: 'Draft together in real time',
    icon: FilePlus,
    opens: { kind: 'document' },
  },
  {
    id: 'task',
    label: 'New task',
    description: 'Capture and assign work',
    icon: SquarePen,
    opens: { kind: 'task' },
  },
  {
    id: 'invite',
    label: 'Invite member',
    description: 'Bring a teammate in',
    icon: UserPlus,
    milestone: 7,
  },
]

export function QuickActions({ className }: { className?: string }) {
  const openCreateDialog = useUiStore((state) => state.openCreateDialog)

  return (
    <ul className={cn('grid grid-cols-2 gap-2 lg:grid-cols-4', className)}>
      {ACTIONS.map((action) => {
        const Icon = action.icon

        return (
          <li key={action.id}>
            <button
              type="button"
              onClick={() => {
                if (action.opens) {
                  openCreateDialog(action.opens)
                  return
                }
                toast.show({
                  title: `${action.label} isn’t built yet`,
                  description: 'The workspace is wired and ready for it.',
                })
              }}
              className={cn(
                'group flex h-full w-full flex-col items-start gap-2 rounded-lg border border-border',
                'bg-surface p-3 text-left',
                'transition-[border-color,background-color] duration-(--duration-fast) ease-(--ease-out-quart)',
                'hover:border-border-strong hover:bg-surface-hover',
                'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
                'focus-visible:ring-offset-background',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-8 items-center justify-center rounded-md',
                  'bg-primary-subtle text-primary-subtle-foreground',
                )}
              >
                <Icon className="size-4" />
              </span>

              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body font-medium text-foreground">
                  {action.label}
                </span>
                <span className="mt-0.5 text-caption text-foreground-muted">
                  {action.description}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
