import { FolderKanban, LayoutGrid, List as ListIcon, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ProjectCard, ProjectCardSkeleton } from '@/components/projects/ProjectCard'
import { AvatarGroup } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { QueryState } from '@/components/ui/QueryState'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { routes } from '@/constants/routes'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { useProjects } from '@/hooks/useWorkspaceContent'
import { useUiStore } from '@/store/uiStore'
import {
  PROJECT_STATUS_LABELS,
  ProjectStatus,
  projectProgress,
  type Project,
} from '@/types/project'
import { formatDueDate, formatRelativeTime } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * Project list. (CLAUDE.md §32)
 *
 * Card and row views over one fetched list. The row view exists because a
 * fifteen-project workspace is a scanning problem, not a browsing one — cards
 * are better for five, rows for fifty.
 */

type ViewMode = 'grid' | 'list'

const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  ...[
    ProjectStatus.Active,
    ProjectStatus.Planning,
    ProjectStatus.OnHold,
    ProjectStatus.Completed,
  ].map((status) => ({ value: status, label: PROJECT_STATUS_LABELS[status] })),
]

const STATUS_VARIANT: Record<ProjectStatus, 'primary' | 'success' | 'warning' | 'neutral'> = {
  [ProjectStatus.Active]: 'primary',
  [ProjectStatus.Completed]: 'success',
  [ProjectStatus.OnHold]: 'warning',
  [ProjectStatus.Planning]: 'neutral',
}

function ProjectRow({ project }: { project: Project }) {
  const progress = projectProgress(project)
  const due = project.dueDate ? formatDueDate(project.dueDate) : null

  return (
    <li>
      <Link
        to={routes.workspace.project(project.workspaceId, project.id)}
        className={cn(
          'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-2.5',
          'transition-colors duration-(--duration-fast) hover:bg-surface-hover',
          'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
          'sm:grid-cols-[minmax(0,2fr)_8rem_minmax(0,1fr)_auto]',
        )}
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body font-medium text-foreground">{project.name}</span>
          {project.description ? (
            <span className="truncate text-caption text-foreground-subtle">
              {project.description}
            </span>
          ) : null}
        </span>

        <span className="hidden flex-col gap-1 sm:flex">
          <span className="flex items-baseline justify-between text-caption">
            <span className="text-foreground-subtle">
              {project.completedTaskCount}/{project.taskCount}
            </span>
            <span className="tabular-nums text-foreground-muted">{progress}%</span>
          </span>
          <ProgressBar
            value={progress}
            label={project.name}
            tone={project.status === ProjectStatus.Completed ? 'success' : 'primary'}
          />
        </span>

        <span className="hidden items-center gap-3 sm:flex">
          <AvatarGroup users={project.members} max={3} size="xs" />
          <span className="truncate text-caption text-foreground-subtle">
            {due ? due.label : `Updated ${formatRelativeTime(project.updatedAt)}`}
          </span>
        </span>

        <Badge size="sm" variant={STATUS_VARIANT[project.status]} className="shrink-0">
          {PROJECT_STATUS_LABELS[project.status]}
        </Badge>
      </Link>
    </li>
  )
}

export function ProjectsPage() {
  const { workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const projectsQuery = useProjects(workspaceId)
  const openCreateDialog = useUiStore((state) => state.openCreateDialog)
  const startCreate = () => openCreateDialog({ kind: 'project' })

  const [view, setView] = useState<ViewMode>('grid')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const filter = (projects: Project[]) =>
    statusFilter === 'all'
      ? projects
      : projects.filter((project) => project.status === statusFilter)

  return (
    <div className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-h1 text-foreground">Projects</h1>
          <p className="mt-1 text-body text-foreground-muted">
            Work grouped by outcome, with progress tracked against it.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={startCreate}
          leadingIcon={<Plus aria-hidden="true" />}
          disabled={!workspaceId}
        >
          New project
        </Button>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Select
          label="Status"
          hideLabel
          options={STATUS_FILTERS}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          containerClassName="w-40"
        />

        <div
          role="group"
          aria-label="View"
          className="ml-auto flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5"
        >
          {(
            [
              { id: 'grid', label: 'Grid', icon: LayoutGrid },
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
      </div>

      <div className="mt-4">
        <QueryState
          query={projectsQuery}
          isEmpty={(projects) => filter(projects).length === 0}
          errorTitle="Couldn't load projects"
          loading={
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
              <span className="sr-only" role="status">
                Loading projects
              </span>
              <ProjectCardSkeleton />
              <ProjectCardSkeleton />
              <ProjectCardSkeleton />
            </div>
          }
          empty={
            /* Two different empties: nothing at all, versus nothing matching
               the filter. Offering "Create project" to someone who has fifteen
               of them and simply picked the wrong filter is unhelpful. */
            statusFilter === 'all' ? (
              <EmptyState
                icon={<FolderKanban />}
                title="No projects yet"
                description="Create your first project to group work and track progress against it."
                action={
                  <Button variant="primary" onClick={startCreate}>
                    Create project
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<FolderKanban />}
                title="No matching projects"
                description={`Nothing here is marked "${PROJECT_STATUS_LABELS[statusFilter as ProjectStatus] ?? statusFilter}".`}
                action={
                  <Button variant="secondary" onClick={() => setStatusFilter('all')}>
                    Clear filter
                  </Button>
                }
              />
            )
          }
        >
          {(projects) =>
            view === 'grid' ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filter(projects).map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            ) : (
              <ul className="rounded-lg border border-border bg-surface p-1.5">
                {filter(projects).map((project) => (
                  <ProjectRow key={project.id} project={project} />
                ))}
              </ul>
            )
          }
        </QueryState>
      </div>
    </div>
  )
}

/** Exported for the project detail page's Overview tab. */
export function ProjectRowSkeleton() {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5" aria-hidden="true">
      <div className="flex-1 space-y-1.5">
        <Skeleton shape="text" className="h-3.5 w-1/3" />
        <Skeleton shape="text" className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-5 w-16" />
    </li>
  )
}
