import { useDraggable } from '@dnd-kit/core'
import { Check, EllipsisVertical, MessageSquare } from 'lucide-react'

import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dropdown, DropdownItem, DropdownLabel } from '@/components/ui/Dropdown'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  TaskPriority,
  type Task,
  type TaskStatus,
} from '@/types/task'
import { formatDueDate } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * Kanban card. (CLAUDE.md §42)
 *
 * DRAG AND KEYBOARD
 *
 * The card body is a real <button> carrying dnd-kit's draggable listeners, so
 * one element serves three interactions: click to open, pointer-drag to move,
 * and — because a button is focusable and the listeners include `onKeyDown` —
 * Space-then-arrows to move by keyboard. dnd-kit's KeyboardSensor drives that
 * last one and announces each step through a live region.
 *
 * The "move to" menu sits *outside* the button rather than inside it, which
 * keeps the markup valid (no nested interactive elements) and, more usefully,
 * means the board is fully operable with no dragging at all — which is how it
 * behaves on touch, where dragging between columns is awkward at best. Drag is
 * an accelerator here, never the only route. (§19)
 */

const PRIORITY_BAR: Record<TaskPriority, string> = {
  urgent: 'bg-danger',
  high: 'bg-warning',
  medium: 'bg-primary',
  low: 'bg-muted',
}

export interface TaskCardProps {
  task: Task
  onOpen: (task: Task) => void
  onMove: (task: Task, status: TaskStatus) => void
  /** Hides the project name inside a single project's board. */
  hideProject?: boolean
}

export function TaskCard({ task, onOpen, onMove, hideProject = false }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  })

  const due = task.dueDate ? formatDueDate(task.dueDate) : null

  return (
    <li
      ref={setNodeRef}
      className={cn(
        'relative rounded-lg border border-border bg-surface',
        'transition-[border-color,box-shadow,opacity] duration-(--duration-fast)',
        'hover:border-border-strong',
        // The original stays in place at reduced opacity while a DragOverlay
        // copy follows the cursor — removing it would collapse the column and
        // make every other card jump.
        isDragging && 'opacity-40',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(task)}
        className={cn(
          'flex w-full cursor-grab flex-col gap-2 p-3 pr-9 text-left active:cursor-grabbing',
          'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
          'rounded-lg',
        )}
        {...listeners}
        {...attributes}
      >
        <span className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className={cn('mt-1 h-3.5 w-0.5 shrink-0 rounded-full', PRIORITY_BAR[task.priority])}
          />
          <span className="min-w-0 flex-1 text-body text-foreground">{task.title}</span>
        </span>

        {!hideProject ? (
          <span className="truncate pl-2.5 text-caption text-foreground-subtle">
            {task.projectName}
          </span>
        ) : null}

        <span className="flex items-center gap-2 pl-2.5">
          {due ? (
            <span
              className={cn(
                'text-caption',
                due.tone === 'overdue'
                  ? 'text-danger'
                  : due.tone === 'today'
                    ? 'text-warning'
                    : 'text-foreground-subtle',
              )}
            >
              {due.label}
            </span>
          ) : null}

          {task.commentCount > 0 ? (
            <span className="flex items-center gap-0.5 text-caption text-foreground-subtle">
              <MessageSquare className="size-3" aria-hidden="true" />
              {task.commentCount}
            </span>
          ) : null}

          {/* Two labels, then a count. Showing only the first hid the rest
              entirely; showing all of them wraps the card to three lines the
              moment someone tags properly. The full set is in the sr-only
              summary below, and in the detail dialog. */}
          {task.labels.slice(0, 2).map((label) => (
            <Badge key={label.id} size="sm" variant="outline">
              {label.name}
            </Badge>
          ))}
          {task.labels.length > 2 ? (
            <span className="text-caption text-foreground-subtle">
              +{task.labels.length - 2}
            </span>
          ) : null}

          <span className="ml-auto shrink-0">
            {task.assignee ? (
              <Avatar
                size="xs"
                name={task.assignee.name}
                userId={task.assignee.id}
                src={task.assignee.avatarUrl}
              />
            ) : null}
          </span>
        </span>

        {/* Everything the colours and position encode, stated in words. */}
        <span className="sr-only">
          {TASK_PRIORITY_LABELS[task.priority]} priority, in {TASK_STATUS_LABELS[task.status]}
          {task.assignee ? `, assigned to ${task.assignee.name}` : ', unassigned'}
          {task.labels.length > 0
            ? `, labelled ${task.labels.map((label) => label.name).join(', ')}`
            : ''}
        </span>
      </button>

      <div className="absolute right-1 top-1">
        <Dropdown
          align="end"
          label={`Move ${task.title}`}
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${task.title}`}>
              <EllipsisVertical aria-hidden="true" />
            </Button>
          }
        >
          <DropdownLabel>Move to</DropdownLabel>
          {TASK_STATUS_ORDER.map((status) => (
            <DropdownItem
              key={status}
              disabled={status === task.status}
              onClick={() => onMove(task, status)}
            >
              <span className="flex items-center justify-between gap-2">
                {TASK_STATUS_LABELS[status]}
                {status === task.status ? (
                  <Check className="size-3.5 text-primary" aria-hidden="true" />
                ) : null}
              </span>
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
    </li>
  )
}

/** Static copy rendered in the DragOverlay — no listeners, no drag state. */
export function TaskCardPreview({ task }: { task: Task }) {
  return (
    <div className="w-64 rounded-lg border border-primary bg-surface p-3 shadow-lg">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={cn('mt-1 h-3.5 w-0.5 shrink-0 rounded-full', PRIORITY_BAR[task.priority])}
        />
        <span className="min-w-0 flex-1 text-body text-foreground">{task.title}</span>
      </div>
    </div>
  )
}

export function TaskCardSkeleton() {
  return (
    <li className="rounded-lg border border-border bg-surface p-3" aria-hidden="true">
      <Skeleton shape="text" className="h-3.5 w-4/5" />
      <Skeleton shape="text" className="mt-2 h-3 w-1/3" />
      <div className="mt-3 flex items-center justify-between">
        <Skeleton shape="text" className="h-3 w-16" />
        <Skeleton shape="circle" className="size-5" />
      </div>
    </li>
  )
}
