import { ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { routes } from '@/constants/routes'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/utils/cn'

/**
 * Breadcrumbs. (CLAUDE.md §29)
 *
 * Derived from the URL, because the URL is the one thing guaranteed to be
 * correct on a cold load of a deep link — it yields "Document" for a record
 * whose title only the page knows.
 *
 * A screen that knows better *publishes* its trail with `usePageBreadcrumbs`,
 * and this reads it from the UI store. Publishing rather than peeking into the
 * query cache matters: `getQueryData` is a one-shot read that does not
 * subscribe, so a breadcrumb resolved that way renders "Document" and never
 * updates when the real title arrives — which is exactly what it did.
 */

export interface Crumb {
  label: string
  /** Omit for the current page, which is not a link. */
  to?: string
}

/** URL segment → section label, for the workspace-scoped routes of §24. */
const SECTION_LABELS: Record<string, string> = {
  projects: 'Projects',
  documents: 'Documents',
  tasks: 'Tasks',
  activity: 'Activity',
  members: 'Members',
  settings: 'Settings',
}

/** Section → label for one of its records, used when a title isn't known yet. */
const RECORD_LABELS: Record<string, string> = {
  projects: 'Project',
  documents: 'Document',
  tasks: 'Task',
}

function buildTrail(
  pathname: string,
  workspaceName: string | null,
  workspaceId: string | null,
): Crumb[] {
  if (pathname === routes.app.dashboard) return [{ label: 'Dashboard' }]

  const segments = pathname.split('/').filter(Boolean)
  // Expected shape: app / workspaces / :workspaceId / [section] / [recordId]
  if (segments[0] !== 'app' || segments[1] !== 'workspaces' || !workspaceId) return []

  const trail: Crumb[] = [
    { label: workspaceName ?? 'Workspace', to: routes.workspace.projects(workspaceId) },
  ]

  const section = segments[3]
  if (!section) return [{ label: workspaceName ?? 'Workspace' }]

  const sectionLabel = SECTION_LABELS[section]
  if (!sectionLabel) return trail

  const recordId = segments[4]
  trail.push({
    label: sectionLabel,
    ...(recordId ? { to: `/app/workspaces/${workspaceId}/${section}` } : {}),
  })

  // Generic fallback until the page publishes something better.
  if (recordId) {
    trail.push({ label: RECORD_LABELS[section] ?? 'Details' })
  }

  return trail
}

export interface BreadcrumbsProps {
  /** Overrides the URL-derived trail. */
  trail?: readonly Crumb[]
  className?: string
}

export function Breadcrumbs({ trail, className }: BreadcrumbsProps) {
  const { pathname } = useLocation()
  const { workspace } = useActiveWorkspace()
  const published = useUiStore((state) => state.breadcrumbTrail)

  const crumbs =
    trail ?? published ?? buildTrail(pathname, workspace?.name ?? null, workspace?.id ?? null)

  if (crumbs.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex items-center gap-1">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1

          return (
            <li
              key={`${crumb.label}-${index}`}
              className={cn(
                'flex min-w-0 items-center gap-1',
                // At phone widths only the current page survives; the ancestors
                // would consume the whole bar and force the topbar to scroll.
                !isLast && 'hidden sm:flex',
              )}
            >
              {crumb.to && !isLast ? (
                <Link
                  to={crumb.to}
                  className={cn(
                    'truncate rounded-xs px-1 py-0.5 text-body text-foreground-muted',
                    'transition-colors duration-(--duration-fast) hover:text-foreground',
                    'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  )}
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className="truncate px-1 py-0.5 text-body font-medium text-foreground"
                  // Marks the current page for assistive tech without needing
                  // the visual weight to carry the meaning.
                  aria-current={isLast ? 'page' : undefined}
                >
                  {crumb.label}
                </span>
              )}

              {!isLast ? (
                <ChevronRight
                  className="size-3.5 shrink-0 text-foreground-subtle"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
