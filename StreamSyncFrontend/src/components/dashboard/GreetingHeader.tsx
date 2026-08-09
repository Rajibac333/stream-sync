import { Link } from 'react-router-dom'
import type { UseQueryResult } from '@tanstack/react-query'

import { Skeleton } from '@/components/ui/Skeleton'
import { routes } from '@/constants/routes'
import type { DashboardSummary } from '@/types/dashboard'
import { cn } from '@/utils/cn'

/**
 * Dashboard header. (CLAUDE.md §31)
 *
 * A greeting, the date, and a one-sentence summary of what actually needs
 * attention — then a compact strip of figures.
 *
 * The strip is deliberately *not* four cards. §31 rules out a wall of them, and
 * a bordered box per number gives four equally-weighted panels that say nothing
 * about relative importance. Inline figures separated by rules read as one
 * status line, and leave the visual weight for the work below.
 */

function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

/** The sentence that tells the user whether they can relax. */
function summarySentence(summary: DashboardSummary): string {
  const { dueTodayCount, openTaskCount, activeProjectCount } = summary

  if (openTaskCount === 0) {
    return 'Nothing is open across your projects. Enjoy it.'
  }
  if (dueTodayCount === 0) {
    return `No deadlines today — ${openTaskCount} open ${openTaskCount === 1 ? 'task' : 'tasks'} across ${activeProjectCount} active ${activeProjectCount === 1 ? 'project' : 'projects'}.`
  }
  return `${dueTodayCount} ${dueTodayCount === 1 ? 'task needs' : 'tasks need'} attention today, across ${activeProjectCount} active ${activeProjectCount === 1 ? 'project' : 'projects'}.`
}

interface Figure {
  label: string
  value: number
  href?: string
  /** Highlights the one number that implies work right now. */
  emphasis?: boolean
}

export interface GreetingHeaderProps {
  firstName: string
  workspaceId: string | null
  query: UseQueryResult<DashboardSummary>
}

export function GreetingHeader({ firstName, workspaceId, query }: GreetingHeaderProps) {
  const now = new Date()
  const { data: summary, isPending, isError } = query

  const figures: Figure[] = summary
    ? [
        {
          // "Today", not "Due today": the figure counts overdue work as well,
          // and must match the section of the same name below it.
          label: 'Today',
          value: summary.dueTodayCount,
          emphasis: summary.dueTodayCount > 0,
          ...(workspaceId ? { href: routes.workspace.tasks(workspaceId) } : {}),
        },
        {
          label: 'Open tasks',
          value: summary.openTaskCount,
          ...(workspaceId ? { href: routes.workspace.tasks(workspaceId) } : {}),
        },
        {
          label: 'Active projects',
          value: summary.activeProjectCount,
          ...(workspaceId ? { href: routes.workspace.projects(workspaceId) } : {}),
        },
        { label: 'Done this week', value: summary.completedThisWeekCount },
      ]
    : []

  return (
    <header>
      <p className="text-caption text-foreground-subtle">
        <time dateTime={now.toISOString().slice(0, 10)}>{dateFormatter.format(now)}</time>
      </p>

      <h1 className="mt-1 text-h1 text-foreground">
        {greetingFor(now)}, {firstName}
      </h1>

      <div className="mt-1.5 min-h-5">
        {isPending ? (
          <Skeleton shape="text" className="h-4 w-72 max-w-full" />
        ) : isError ? (
          // The sentence is a summary, not the content. If it fails the page
          // below is still entirely usable, so this stays quiet rather than
          // raising an error state over the whole header.
          <p className="text-body text-foreground-muted">Here's where things stand.</p>
        ) : (
          <p className="text-body text-foreground-muted">{summarySentence(summary)}</p>
        )}
      </div>

      {/* Figures.
          A list rather than a <dl>: the linked ones need an <a> wrapping both
          the number and its label, and an anchor is not a permitted child of a
          description list. Each item's accessible name is "12 Open tasks",
          which is what a screen reader should read anyway. */}
      <ul className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 sm:gap-x-8">
        {isPending
          ? Array.from({ length: 4 }, (_, index) => (
              <li key={index} className="flex flex-col gap-1" aria-hidden="true">
                <Skeleton shape="text" className="h-6 w-10" />
                <Skeleton shape="text" className="h-3 w-16" />
              </li>
            ))
          : figures.map((figure) => {
              const body = (
                <>
                  <span
                    className={cn(
                      'text-h2 tabular-nums',
                      figure.emphasis ? 'text-primary' : 'text-foreground',
                    )}
                  >
                    {figure.value}
                  </span>
                  <span className="mt-0.5 text-caption text-foreground-muted">{figure.label}</span>
                </>
              )

              return (
                <li key={figure.label}>
                  {figure.href ? (
                    <Link
                      to={figure.href}
                      className={cn(
                        'flex flex-col rounded-sm outline-none',
                        'transition-opacity duration-(--duration-fast) hover:opacity-70',
                        'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
                        'focus-visible:ring-offset-background',
                      )}
                    >
                      {body}
                    </Link>
                  ) : (
                    <span className="flex flex-col">{body}</span>
                  )}
                </li>
              )
            })}
      </ul>
    </header>
  )
}
