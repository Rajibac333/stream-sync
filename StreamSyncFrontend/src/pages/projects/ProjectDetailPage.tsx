import { CalendarClock, FileText, ListChecks, Plus, Users } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ActivityFeed, ActivityFeedSkeleton } from '@/components/activity/ActivityFeed'
import { DocumentRow, DocumentRowSkeleton } from '@/components/documents/DocumentRow'
import { KanbanBoard, KanbanBoardSkeleton } from '@/components/tasks/KanbanBoard'
import { TaskDetailDialog } from '@/components/tasks/TaskDetailDialog'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { buttonVariants } from '@/components/ui/Button.variants'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { QueryState } from '@/components/ui/QueryState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tab, TabPanel, Tabs, TabsList } from '@/components/ui/Tabs'
import { routes } from '@/constants/routes'
import { useUpdateTask } from '@/hooks/useContentMutations'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { useUiStore } from '@/store/uiStore'
import {
  groupTasksByStatus,
  useActivity,
  useDocuments,
  useProject,
  useTasks,
} from '@/hooks/useWorkspaceContent'
import {
  PROJECT_STATUS_LABELS,
  ProjectStatus,
  projectProgress,
  type Project,
} from '@/types/project'
import { TaskStatus, type Task } from '@/types/task'
import { formatDueDate, formatRelativeTime } from '@/utils/format'

/**
 * Project detail. (CLAUDE.md §32)
 *
 * Header plus the four sections §32 requires — Overview, Documents, Tasks,
 * Activity — as a real WAI-ARIA tab set, so ← → move between them and only the
 * selected tab is in the page's tab order.
 *
 * Every panel filters the *workspace-wide* cached lists rather than issuing
 * per-project requests. Opening a project after the dashboard has loaded costs
 * one request (the project itself), not four.
 */

const STATUS_VARIANT: Record<ProjectStatus, 'primary' | 'success' | 'warning' | 'neutral'> = {
  [ProjectStatus.Active]: 'primary',
  [ProjectStatus.Completed]: 'success',
  [ProjectStatus.OnHold]: 'warning',
  [ProjectStatus.Planning]: 'neutral',
}

function ProjectHeader({ project }: { project: Project }) {
  const progress = projectProgress(project)
  const due = project.dueDate ? formatDueDate(project.dueDate) : null

  return (
    <header>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-h1 text-foreground">{project.name}</h1>
        <Badge variant={STATUS_VARIANT[project.status]}>
          {PROJECT_STATUS_LABELS[project.status]}
        </Badge>
      </div>

      {project.description ? (
        <p className="mt-2 max-w-2xl text-body text-foreground-muted">{project.description}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="min-w-48 flex-1 sm:max-w-xs">
          <div className="flex items-baseline justify-between gap-2 text-caption">
            <span className="text-foreground-muted">
              {project.completedTaskCount} of {project.taskCount} tasks done
            </span>
            <span className="font-medium tabular-nums text-foreground">{progress}%</span>
          </div>
          <ProgressBar
            value={progress}
            label={project.name}
            size="md"
            tone={project.status === ProjectStatus.Completed ? 'success' : 'primary'}
            className="mt-1.5"
          />
        </div>

        <div className="flex items-center gap-2">
          <Users className="size-4 text-foreground-subtle" aria-hidden="true" />
          <ul className="flex items-center -space-x-1.5">
            {project.members.map((member) => (
              <li key={member.id}>
                <Avatar
                  size="sm"
                  name={member.name}
                  userId={member.id}
                  src={member.avatarUrl}
                  className="ring-2 ring-background"
                />
              </li>
            ))}
          </ul>
          <span className="text-caption text-foreground-muted">
            {project.members.length} {project.members.length === 1 ? 'member' : 'members'}
          </span>
        </div>

        {due ? (
          <p className="flex items-center gap-1.5 text-caption text-foreground-muted">
            <CalendarClock className="size-4 text-foreground-subtle" aria-hidden="true" />
            <span className={due.tone === 'overdue' ? 'text-danger' : undefined}>{due.label}</span>
          </p>
        ) : null}

        <p className="text-caption text-foreground-subtle">
          Updated {formatRelativeTime(project.updatedAt)}
        </p>
      </div>
    </header>
  )
}

export function ProjectDetailPage() {
  const { projectId, taskId } = useParams<{ projectId?: string; taskId?: string }>()
  const navigate = useNavigate()
  const { workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null

  const projectQuery = useProject(projectId)
  const tasksQuery = useTasks(workspaceId)
  const documentsQuery = useDocuments(workspaceId)
  const activityQuery = useActivity(workspaceId)
  const updateTask = useUpdateTask(workspaceId ?? '')

  const [openTask, setOpenTask] = useState<Task | null>(null)
  const openCreateDialog = useUiStore((state) => state.openCreateDialog)

  const projectTasks = useMemo(
    () => (tasksQuery.data ?? []).filter((task) => task.projectId === projectId),
    [tasksQuery.data, projectId],
  )

  const projectDocuments = useMemo(
    () => (documentsQuery.data ?? []).filter((document) => document.projectId === projectId),
    [documentsQuery.data, projectId],
  )

  /* Activity has no project id of its own, so it is matched through the
     records that belong to this project. Crude, and the real API will filter
     server-side with `?project=`; the panel above it does not change. */
  const projectActivity = useMemo(() => {
    const ids = new Set<string>([
      ...(projectId ? [projectId] : []),
      ...projectTasks.map((task) => task.id),
      ...projectDocuments.map((document) => document.id),
    ])
    return (activityQuery.data ?? []).filter((event) => ids.has(event.target.id))
  }, [activityQuery.data, projectId, projectTasks, projectDocuments])

  const moveTask = useCallback(
    (task: Task, status: TaskStatus) => {
      updateTask.mutate({ taskId: task.id, patch: { status } })
    },
    [updateTask],
  )

  /* Both creators pre-fill this project, so a task added from here cannot
     silently land somewhere else. */
  const startCreateTask = useCallback(
    (status: TaskStatus) =>
      openCreateDialog({ kind: 'task', status, ...(projectId ? { projectId } : {}) }),
    [openCreateDialog, projectId],
  )

  const startCreateDocument = useCallback(
    () => openCreateDialog({ kind: 'document', ...(projectId ? { projectId } : {}) }),
    [openCreateDialog, projectId],
  )

  // A task deep-linked from elsewhere still opens here.
  const activeTask = openTask ?? projectTasks.find((task) => task.id === taskId) ?? null

  if (projectQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-24">
        <ErrorState
          title="Project not available"
          error={projectQuery.error}
          action={
            workspaceId ? (
              <Link
                to={routes.workspace.projects(workspaceId)}
                className={buttonVariants({ variant: 'secondary' })}
              >
                All projects
              </Link>
            ) : null
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 lg:px-8">
      {projectQuery.isPending || !projectQuery.data ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only" role="status">
            Loading project
          </span>
          <Skeleton shape="text" className="h-8 w-64" />
          <Skeleton shape="text" className="h-4 w-96 max-w-full" />
          <Skeleton className="h-1.5 w-full max-w-xs rounded-full" />
        </div>
      ) : (
        <ProjectHeader project={projectQuery.data} />
      )}

      <Tabs defaultValue="overview" className="mt-8">
        <TabsList label="Project sections">
          <Tab value="overview">Overview</Tab>
          <Tab value="documents" count={projectDocuments.length}>
            Documents
          </Tab>
          <Tab value="tasks" count={projectTasks.length}>
            Tasks
          </Tab>
          <Tab value="activity">Activity</Tab>
        </TabsList>

        {/* ---------------------------------------------------------------
            Overview
           --------------------------------------------------------------- */}
        <TabPanel value="overview" className="flex flex-col gap-8 lg:flex-row lg:gap-10">
          <section className="min-w-0 flex-1" aria-label="Task summary">
            <h3 className="mb-3 text-body font-semibold text-foreground">Where things stand</h3>

            <QueryState
              query={tasksQuery}
              isEmpty={() => projectTasks.length === 0}
              errorTitle="Couldn't load tasks"
              loading={<Skeleton className="h-24 w-full" />}
              empty={
                <EmptyState
                  size="inline"
                  icon={<ListChecks />}
                  title="No tasks yet"
                  description="Add the first task to start tracking progress."
                  action={
                    <Button variant="secondary" onClick={() => startCreateTask(TaskStatus.Todo)}>
                      Add task
                    </Button>
                  }
                />
              }
            >
              {() => {
                const grouped = groupTasksByStatus(projectTasks)

                return (
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {(Object.keys(grouped) as TaskStatus[]).map((status) => (
                      <li
                        key={status}
                        className="rounded-lg border border-border bg-surface px-3 py-2.5"
                      >
                        <p className="text-caption text-foreground-muted">
                          {status === TaskStatus.InProgress
                            ? 'In Progress'
                            : status.charAt(0).toUpperCase() + status.slice(1)}
                        </p>
                        <p className="mt-0.5 text-h2 tabular-nums text-foreground">
                          {grouped[status].length}
                        </p>
                      </li>
                    ))}
                  </ul>
                )
              }}
            </QueryState>
          </section>

          <section className="lg:w-80" aria-label="Recent activity">
            <h3 className="mb-3 text-body font-semibold text-foreground">Recent activity</h3>
            <QueryState
              query={activityQuery}
              isEmpty={() => projectActivity.length === 0}
              errorTitle="Couldn't load activity"
              loading={<ActivityFeedSkeleton rows={3} />}
              empty={
                <EmptyState
                  size="inline"
                  title="Nothing yet"
                  description="Edits and completed tasks show up here."
                />
              }
            >
              {() => <ActivityFeed events={projectActivity.slice(0, 5)} />}
            </QueryState>
          </section>
        </TabPanel>

        {/* ---------------------------------------------------------------
            Documents
           --------------------------------------------------------------- */}
        <TabPanel value="documents">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-body font-semibold text-foreground">Documents</h3>
            <Button
              size="sm"
              onClick={startCreateDocument}
              leadingIcon={<Plus aria-hidden="true" />}
              disabled={!workspaceId}
            >
              New document
            </Button>
          </div>

          <QueryState
            query={documentsQuery}
            isEmpty={() => projectDocuments.length === 0}
            errorTitle="Couldn't load documents"
            loading={
              <ul className="rounded-lg border border-border bg-surface p-1.5" aria-busy="true">
                <DocumentRowSkeleton />
                <DocumentRowSkeleton />
              </ul>
            }
            empty={
              <EmptyState
                size="inline"
                icon={<FileText />}
                title="No documents in this project"
                description="Specs, notes and decisions live here alongside the work."
                action={
                  <Button variant="secondary" onClick={startCreateDocument}>
                    Create document
                  </Button>
                }
              />
            }
          >
            {() => (
              <ul className="rounded-lg border border-border bg-surface p-1.5">
                {projectDocuments.map((document) => (
                  <DocumentRow key={document.id} document={document} />
                ))}
              </ul>
            )}
          </QueryState>
        </TabPanel>

        {/* ---------------------------------------------------------------
            Tasks
           --------------------------------------------------------------- */}
        <TabPanel value="tasks">
          <QueryState
            query={tasksQuery}
            isEmpty={() => projectTasks.length === 0}
            errorTitle="Couldn't load tasks"
            loading={<KanbanBoardSkeleton />}
            empty={
              <EmptyState
                icon={<ListChecks />}
                title="No tasks in this project"
                description="Break the work down and track it across the board."
                action={
                  <Button variant="primary" onClick={() => startCreateTask(TaskStatus.Todo)}>
                    Create task
                  </Button>
                }
              />
            }
          >
            {() => (
              <KanbanBoard
                columns={groupTasksByStatus(projectTasks)}
                onOpen={setOpenTask}
                onMove={moveTask}
                onAdd={startCreateTask}
                hideProject
              />
            )}
          </QueryState>
        </TabPanel>

        {/* ---------------------------------------------------------------
            Activity
           --------------------------------------------------------------- */}
        <TabPanel value="activity">
          <QueryState
            query={activityQuery}
            isEmpty={() => projectActivity.length === 0}
            errorTitle="Couldn't load activity"
            loading={<ActivityFeedSkeleton rows={6} />}
            empty={
              <EmptyState
                size="inline"
                title="No activity yet"
                description="Edits, comments and completed tasks show up here."
              />
            }
          >
            {() => (
              <div className="max-w-2xl">
                <ActivityFeed events={projectActivity} />
              </div>
            )}
          </QueryState>
        </TabPanel>
      </Tabs>

      {/* Creation dialogs are mounted once by the shell. */}
      {workspaceId ? (
        <>
          <TaskDetailDialog
            task={activeTask}
            onOpenChange={() => {
              setOpenTask(null)
              // A deep link carried the task in the URL, so closing has to
              // leave that URL behind or the dialog reopens immediately.
              if (taskId && projectId) {
                navigate(routes.workspace.project(workspaceId, projectId), { replace: true })
              }
            }}
            workspaceId={workspaceId}
          />
        </>
      ) : null}
    </div>
  )
}
