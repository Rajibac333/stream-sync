import { LayoutGrid, ListChecks, List as ListIcon, Plus, Tag } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { KanbanBoard, KanbanBoardSkeleton } from '@/components/tasks/KanbanBoard'
import { TaskDetailDialog } from '@/components/tasks/TaskDetailDialog'
import { TaskRow, TaskRowSkeleton } from '@/components/tasks/TaskRow'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueryState } from '@/components/ui/QueryState'
import { routes } from '@/constants/routes'
import { useUpdateTask } from '@/hooks/useContentMutations'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { useUiStore } from '@/store/uiStore'
import { groupTasksByStatus, useLabels, useTasks } from '@/hooks/useWorkspaceContent'
import { TaskStatus, type Task } from '@/types/task'
import { cn } from '@/utils/cn'

/**
 * Task board. (CLAUDE.md §42)
 *
 * The open task lives in the URL (`/tasks/:taskId`) rather than in component
 * state. That makes a task linkable — which is what the activity feed, the
 * dashboard and the command menu already assume — and means Back closes the
 * dialog, which is what the browser's Back button should do to an overlay.
 *
 * Board and list are two views of one already-fetched list, not two queries.
 */

type ViewMode = 'board' | 'list'

export function TasksPage() {
  const navigate = useNavigate()
  const { taskId } = useParams<{ taskId?: string }>()
  const { workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null

  const tasksQuery = useTasks(workspaceId)
  const { data: labels } = useLabels(workspaceId)
  const openCreateDialog = useUiStore((state) => state.openCreateDialog)
  const updateTask = useUpdateTask(workspaceId ?? '')

  const [view, setView] = useState<ViewMode>('board')
  const [labelFilter, setLabelFilter] = useState('all')

  const openTask = useCallback(
    (task: Task) => {
      if (workspaceId) navigate(routes.workspace.task(workspaceId, task.id))
    },
    [navigate, workspaceId],
  )

  const closeTask = useCallback(() => {
    if (workspaceId) navigate(routes.workspace.tasks(workspaceId))
  }, [navigate, workspaceId])

  const moveTask = useCallback(
    (task: Task, status: TaskStatus) => {
      updateTask.mutate({ taskId: task.id, patch: { status } })
    },
    [updateTask],
  )

  const startCreate = useCallback(
    (status: TaskStatus) => openCreateDialog({ kind: 'task', status }),
    [openCreateDialog],
  )

  /* Filtering happens before grouping so the column counts describe what is
     actually on screen — a board reading "Todo 6" above three visible cards is
     the same class of lie as a badge disagreeing with its list.

     Derived once rather than per call site: this was a memoised *function*, so
     the filter ran on every render for the empty check and again for the board,
     and the grouping ran on top of that. */
  const filtered = useMemo(() => {
    const tasks = tasksQuery.data ?? []
    return labelFilter === 'all'
      ? tasks
      : tasks.filter((task) => task.labels.some((label) => label.id === labelFilter))
  }, [tasksQuery.data, labelFilter])

  const columns = useMemo(() => groupTasksByStatus(filtered), [filtered])

  const labelOptions = useMemo(
    () => [
      { value: 'all', label: 'All labels' },
      ...(labels ?? []).map((label) => ({ value: label.id, label: label.name })),
    ],
    [labels],
  )

  const activeTask = tasksQuery.data?.find((task) => task.id === taskId) ?? null

  return (
    <div className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-h1 text-foreground">Tasks</h1>
          <p className="mt-1 text-body text-foreground-muted">
            Everything in progress across {workspace?.name ?? 'this workspace'}.
          </p>
        </div>

        <Select
          label="Label"
          hideLabel
          options={labelOptions}
          value={labelFilter}
          onChange={(event) => setLabelFilter(event.target.value)}
          containerClassName="w-40"
        />

        {/* Segmented control. Two toggle buttons with `aria-pressed` rather
            than a tablist — these swap a rendering of the same data, they do
            not switch between tab panels. */}
        <div
          role="group"
          aria-label="View"
          className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5"
        >
          {(
            [
              { id: 'board', label: 'Board', icon: LayoutGrid },
              { id: 'list', label: 'List', icon: ListIcon },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-body',
                'transition-colors duration-(--duration-fast)',
                'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                view === id
                  ? 'bg-surface-active font-medium text-foreground'
                  : 'text-foreground-muted hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <Button
          variant="primary"
          onClick={() => startCreate(TaskStatus.Todo)}
          leadingIcon={<Plus aria-hidden="true" />}
          disabled={!workspaceId}
        >
          New task
        </Button>
      </header>

      <div className="mt-6">
        <QueryState
          query={tasksQuery}
          errorTitle="Couldn't load tasks"
          isEmpty={() => filtered.length === 0}
          loading={view === 'board' ? <KanbanBoardSkeleton /> : <TaskListSkeleton />}
          empty={
            labelFilter === 'all' ? (
              <EmptyState
                icon={<ListChecks />}
                title="No tasks yet"
                description="Create your first task to start tracking work across this workspace."
                action={
                  <Button variant="primary" onClick={() => startCreate(TaskStatus.Todo)}>
                    Create task
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Tag />}
                title="No matching tasks"
                description="Nothing here carries that label."
                action={
                  <Button variant="secondary" onClick={() => setLabelFilter('all')}>
                    Clear filter
                  </Button>
                }
              />
            )
          }
        >
          {() =>
            view === 'board' ? (
              <KanbanBoard
                columns={columns}
                onOpen={openTask}
                onMove={moveTask}
                onAdd={startCreate}
              />
            ) : (
              <ul className="rounded-lg border border-border bg-surface p-1.5">
                {filtered.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            )
          }
        </QueryState>
      </div>

      {/* Creation dialogs are mounted once by the shell; only the detail
          dialog is page-owned, because the task it shows comes from the URL.
          It is rendered solely once the task is in the cache — a dialog for an
          unresolved id would flash an empty shell on a cold deep link. */}
      {workspaceId ? (
        <TaskDetailDialog task={activeTask} onOpenChange={closeTask} workspaceId={workspaceId} />
      ) : null}
    </div>
  )
}

function TaskListSkeleton() {
  return (
    <ul className="rounded-lg border border-border bg-surface p-1.5" aria-busy="true">
      <span className="sr-only" role="status">
        Loading tasks
      </span>
      <TaskRowSkeleton />
      <TaskRowSkeleton />
      <TaskRowSkeleton />
      <TaskRowSkeleton />
    </ul>
  )
}
