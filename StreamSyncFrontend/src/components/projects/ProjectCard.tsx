import { Link } from 'react-router-dom'

import { AvatarGroup } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Skeleton } from '@/components/ui/Skeleton'
import { routes } from '@/constants/routes'
import { PROJECT_STATUS_LABELS, ProjectStatus, projectProgress, type Project } from '@/types/project'
import { formatDueDate, formatRelativeTime } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * Project card. (CLAUDE.md §32)
 *
 * The whole card is one link rather than a div with a nested link, so it is a
 * single tab stop with one accessible name — a card containing three separate
 * links to the same place makes a keyboard user press Tab three times to get
 * past it.
 */

const STATUS_VARIANT: Record<ProjectStatus, 'primary' | 'success' | 'warning' | 'neutral'> = {
  [ProjectStatus.Active]: 'primary',
  [ProjectStatus.Completed]: 'success',
  [ProjectStatus.OnHold]: 'warning',
  [ProjectStatus.Planning]: 'neutral',
}

export function ProjectCard({ project }: { project: Project }) {
  const progress = projectProgress(project)
  const due = project.dueDate ? formatDueDate(project.dueDate) : null
  const isComplete = project.status === ProjectStatus.Completed

  return (
    <Link
      to={routes.workspace.project(project.workspaceId, project.id)}
      className={cn(
        'group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4',
        'transition-[border-color,background-color] duration-(--duration-fast) ease-(--ease-out-quart)',
        'hover:border-border-strong hover:bg-surface-hover',
        'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
        'focus-visible:ring-offset-background',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-medium text-foreground">{project.name}</h3>
          {project.description ? (
            <p className="mt-1 line-clamp-2 text-small text-foreground-muted">
              {project.description}
            </p>
          ) : null}
        </div>

        <Badge size="sm" variant={STATUS_VARIANT[project.status]} className="shrink-0">
          {PROJECT_STATUS_LABELS[project.status]}
        </Badge>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-caption">
          <span className="text-foreground-muted">
            {project.completedTaskCount} of {project.taskCount} tasks
          </span>
          <span className="font-medium tabular-nums text-foreground">{progress}%</span>
        </div>
        <ProgressBar
          value={progress}
          label={project.name}
          tone={isComplete ? 'success' : 'primary'}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <AvatarGroup users={project.members} max={4} size="xs" />

        <span className="truncate text-caption text-foreground-subtle">
          {due && !isComplete ? (
            <span className={cn(due.tone === 'overdue' && 'text-danger')}>{due.label}</span>
          ) : (
            `Updated ${formatRelativeTime(project.updatedAt)}`
          )}
        </span>
      </div>
    </Link>
  )
}

/** Matches the card's real height so the grid does not jump when data lands. */
export function ProjectCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4" aria-hidden="true">
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-2">
          <Skeleton shape="text" className="h-4 w-2/5" />
          <Skeleton shape="text" className="h-3 w-4/5" />
        </div>
        <Skeleton className="h-5 w-14" />
      </div>
      <div className="space-y-1.5">
        <Skeleton shape="text" className="h-3 w-1/3" />
        <Skeleton className="h-1 w-full rounded-full" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton shape="circle" className="size-5" />
        <Skeleton shape="text" className="h-3 w-20" />
      </div>
    </div>
  )
}
