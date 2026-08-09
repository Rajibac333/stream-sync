import { MessageSquare } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Avatar } from '@/components/ui/Avatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tooltip } from '@/components/ui/Tooltip'
import { routes } from '@/constants/routes'
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, TaskPriority, TaskStatus, type Task } from '@/types/task'
import { formatDueDate } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * A single task, as it appears in any list. (CLAUDE.md §42, §43)
 *
 * Priority is shown as a coloured bar *plus* a text label in the accessible
 * name — colour alone is never the message. Same for the due date: "Overdue by
 * 2 days" reads correctly whether or not the red registers. (§19)
 */

const PRIORITY_BAR: Record<TaskPriority, string> = {
  urgent: 'bg-danger',
  high: 'bg-warning',
  medium: 'bg-primary',
  low: 'bg-muted',
}

const STATUS_DOT: Record<TaskStatus, string> = {
  todo: 'border-border-strong',
  in_progress: 'border-primary border-[3px]',
  review: 'border-warning border-[3px]',
  done: 'border-success bg-success',
}

export interface TaskRowProps {
  task: Task
  /** Hides the project name — redundant inside a project's own task list. */
  hideProject?: boolean
}

export function TaskRow({ task, hideProject = false }: TaskRowProps) {
  const due = task.dueDate ? formatDueDate(task.dueDate) : null

  return (
    <li>
      <Link
        to={routes.workspace.task(task.workspaceId, task.id)}
        className={cn(
          'group flex items-center gap-3 rounded-md px-2 py-2',
          'transition-colors duration-(--duration-fast)',
          'hover:bg-surface-hover',
          'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
        )}
      >
        {/* Priority rail — decorative; the label below carries the meaning. */}
        <span
          aria-hidden="true"
          className={cn('h-8 w-0.5 shrink-0 rounded-full', PRIORITY_BAR[task.priority])}
        />

        <span
          aria-hidden="true"
          className={cn('size-3.5 shrink-0 rounded-full border-2', STATUS_DOT[task.status])}
        />

        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              'truncate text-body',
              task.status === TaskStatus.Done
                ? 'text-foreground-muted line-through'
                : 'text-foreground',
            )}
          >
            {task.title}
          </span>

          <span className="mt-0.5 flex items-center gap-2 text-caption text-foreground-subtle">
            {!hideProject ? <span className="truncate">{task.projectName}</span> : null}
            {due ? (
              <>
                {!hideProject ? <span aria-hidden="true">·</span> : null}
                <span className={cn('shrink-0', due.tone === 'overdue' && 'text-danger', due.tone === 'today' && 'text-warning')}>
                  {due.label}
                </span>
              </>
            ) : null}
            {task.commentCount > 0 ? (
              <span className="flex shrink-0 items-center gap-0.5">
                <MessageSquare className="size-3" aria-hidden="true" />
                {task.commentCount}
              </span>
            ) : null}
          </span>
        </span>

        {/* Everything colour-coded above, restated for assistive tech. */}
        <span className="sr-only">
          {TASK_PRIORITY_LABELS[task.priority]} priority, {TASK_STATUS_LABELS[task.status]}
        </span>

        {task.assignee ? (
          <Tooltip content={task.assignee.name}>
            <span className="shrink-0">
              <Avatar
                size="xs"
                name={task.assignee.name}
                userId={task.assignee.id}
                src={task.assignee.avatarUrl}
              />
            </span>
          </Tooltip>
        ) : (
          <span className="shrink-0 text-caption text-foreground-subtle">Unassigned</span>
        )}
      </Link>
    </li>
  )
}

export function TaskRowSkeleton() {
  return (
    <li className="flex items-center gap-3 px-2 py-2" aria-hidden="true">
      <Skeleton className="h-8 w-0.5 rounded-full" />
      <Skeleton shape="circle" className="size-3.5" />
      <div className="flex-1 space-y-1.5">
        <Skeleton shape="text" className="h-3.5 w-3/5" />
        <Skeleton shape="text" className="h-3 w-1/4" />
      </div>
      <Skeleton shape="circle" className="size-5" />
    </li>
  )
}
