import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { useState } from 'react'

import { TaskCard, TaskCardPreview, TaskCardSkeleton } from '@/components/tasks/TaskCard'
import { Button } from '@/components/ui/Button'
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  type Task,
  type TaskStatus,
} from '@/types/task'
import { cn } from '@/utils/cn'

/**
 * Kanban board. (CLAUDE.md §42)
 *
 * WHY dnd-kit
 *
 * Accessible drag-and-drop is genuinely hard: it needs a keyboard path, live
 * announcements, and pointer/touch handling that does not fight scrolling.
 * dnd-kit supplies all three (§7 — a dependency earning its place). It is used
 * for *moving between columns only*; there is no ordering within a column, so
 * `@dnd-kit/sortable` is not needed and is not installed.
 *
 * NOT DESTABILISING
 *
 *   • Every move is also available from each card's menu, so the board works
 *     with no pointer, no drag, and on touch.
 *   • `activationConstraint` requires 6px of movement before a drag begins, so
 *     a click still opens the task rather than starting a doomed drag.
 *   • Drops onto the column a card already sits in are ignored, which avoids a
 *     pointless request on every mis-drag.
 *   • The mutation behind it is optimistic and rolls back on failure, so a
 *     dropped card lands instantly and returns home if the server refuses.
 */

const COLUMN_ACCENT: Record<TaskStatus, string> = {
  todo: 'bg-muted',
  in_progress: 'bg-primary',
  review: 'bg-warning',
  done: 'bg-success',
}

function Column({
  status,
  tasks,
  onOpen,
  onMove,
  onAdd,
  hideProject,
  isDropTarget,
}: {
  status: TaskStatus
  tasks: Task[]
  onOpen: (task: Task) => void
  onMove: (task: Task, status: TaskStatus) => void
  onAdd: (status: TaskStatus) => void
  hideProject: boolean
  isDropTarget: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <section
      aria-label={`${TASK_STATUS_LABELS[status]} — ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
      className="flex min-w-72 flex-1 flex-col rounded-lg border border-border bg-surface-muted/50 lg:min-w-0"
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className={cn('size-2 shrink-0 rounded-full', COLUMN_ACCENT[status])} aria-hidden="true" />
        <h3 className="text-body font-medium text-foreground">{TASK_STATUS_LABELS[status]}</h3>
        <span className="text-caption tabular-nums text-foreground-subtle">{tasks.length}</span>

        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={() => onAdd(status)}
          aria-label={`Add a task to ${TASK_STATUS_LABELS[status]}`}
        >
          <Plus aria-hidden="true" />
        </Button>
      </header>

      <ul
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 rounded-md p-2 pt-0',
          'transition-colors duration-(--duration-fast)',
          // Only the column under the pointer highlights, and only while a drag
          // is actually in progress.
          isDropTarget && isOver && 'bg-primary-subtle',
        )}
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onOpen={onOpen}
            onMove={onMove}
            hideProject={hideProject}
          />
        ))}

        {tasks.length === 0 ? (
          <li className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border p-4 text-center">
            <span className="text-caption text-foreground-subtle">
              {isDropTarget ? 'Drop here' : 'Nothing here yet'}
            </span>
          </li>
        ) : null}
      </ul>
    </section>
  )
}

export interface KanbanBoardProps {
  columns: Record<TaskStatus, Task[]>
  onOpen: (task: Task) => void
  onMove: (task: Task, status: TaskStatus) => void
  onAdd: (status: TaskStatus) => void
  hideProject?: boolean
}

export function KanbanBoard({
  columns,
  onOpen,
  onMove,
  onAdd,
  hideProject = false,
}: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  const sensors = useSensors(
    // 6px of travel before a drag starts, so a click is still a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  /** Spoken by dnd-kit's built-in live region at each stage of a drag. */
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const task = active.data.current?.task as Task | undefined
      return task ? `Picked up ${task.title}. Use arrow keys to choose a column.` : undefined
    },
    onDragOver: ({ over }) =>
      over ? `Now over ${TASK_STATUS_LABELS[over.id as TaskStatus]}.` : undefined,
    onDragEnd: ({ active, over }) => {
      const task = active.data.current?.task as Task | undefined
      if (!task) return undefined
      return over
        ? `Moved ${task.title} to ${TASK_STATUS_LABELS[over.id as TaskStatus]}.`
        : `${task.title} was returned to ${TASK_STATUS_LABELS[task.status]}.`
    },
    onDragCancel: ({ active }) => {
      const task = active.data.current?.task as Task | undefined
      return task ? `Cancelled. ${task.title} stayed where it was.` : undefined
    },
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTask((event.active.data.current?.task as Task | undefined) ?? null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const task = event.active.data.current?.task as Task | undefined
    const target = event.over?.id as TaskStatus | undefined
    setActiveTask(null)

    // No target, or dropped back where it started — nothing to persist.
    if (!task || !target || target === task.status) return
    onMove(task, target)
  }

  return (
    <DndContext
      sensors={sensors}
      // `pointerWithin` rather than the default rectangle intersection: columns
      // are tall and adjacent, and rect-based detection picks the wrong one
      // whenever a card overlaps two of them.
      collisionDetection={pointerWithin}
      accessibility={{ announcements }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveTask(null)}
    >
      {/* Horizontal scroll below lg — four columns cannot fit on a phone, and
          squeezing them makes every card unreadable. (§18) */}
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible">
        {TASK_STATUS_ORDER.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={columns[status]}
            onOpen={onOpen}
            onMove={onMove}
            onAdd={onAdd}
            hideProject={hideProject}
            isDropTarget={activeTask !== null}
          />
        ))}
      </div>

      {/* Rendered in a portal above everything, so the dragged card is never
          clipped by a column's overflow. */}
      <DragOverlay dropAnimation={null}>
        {activeTask ? <TaskCardPreview task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

export function KanbanBoardSkeleton() {
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 lg:grid lg:grid-cols-4" aria-busy="true">
      <span className="sr-only" role="status">
        Loading board
      </span>
      {TASK_STATUS_ORDER.map((status) => (
        <div
          key={status}
          className="flex min-w-72 flex-1 flex-col rounded-lg border border-border bg-surface-muted/50 lg:min-w-0"
        >
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className={cn('size-2 rounded-full', COLUMN_ACCENT[status])} aria-hidden="true" />
            <h3 className="text-body font-medium text-foreground">{TASK_STATUS_LABELS[status]}</h3>
          </div>
          <ul className="flex flex-col gap-2 p-2 pt-0">
            <TaskCardSkeleton />
            <TaskCardSkeleton />
          </ul>
        </div>
      ))}
    </div>
  )
}
