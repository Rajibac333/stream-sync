import { FileText } from 'lucide-react'
import { Link } from 'react-router-dom'

import { AvatarGroup } from '@/components/ui/Avatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { routes } from '@/constants/routes'
import type { DocumentSummary } from '@/types/document'
import { formatAbsoluteTime, formatRelativeTime } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * A document in a list. (CLAUDE.md §33)
 *
 * Shows a live-collaborator pip when someone is currently in the document —
 * the first hint of the presence layer that Milestone 6 makes real. The count
 * comes from the API today and will come from the WebSocket then; nothing in
 * this component has to change for that.
 */
export function DocumentRow({ document }: { document: DocumentSummary }) {
  const activeCount = document.activeCollaboratorIds.length

  return (
    <li>
      <Link
        to={routes.workspace.document(document.workspaceId, document.id)}
        className={cn(
          'group flex items-center gap-3 rounded-md px-2 py-2',
          'transition-colors duration-(--duration-fast) hover:bg-surface-hover',
          'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-muted text-foreground-subtle">
          <FileText className="size-4" aria-hidden="true" />
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate text-body text-foreground">{document.title}</span>

            {activeCount > 0 ? (
              <span className="flex shrink-0 items-center gap-1 text-caption text-success">
                <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                {activeCount}
                <span className="sr-only">
                  {activeCount === 1 ? 'collaborator' : 'collaborators'} editing now
                </span>
              </span>
            ) : null}
          </span>

          <span className="mt-0.5 flex items-center gap-1.5 truncate text-caption text-foreground-subtle">
            {document.projectName ? (
              <>
                <span className="truncate">{document.projectName}</span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span className="shrink-0">
              {document.lastEditedBy.name.split(' ')[0]} edited{' '}
              <time dateTime={document.updatedAt} title={formatAbsoluteTime(document.updatedAt)}>
                {formatRelativeTime(document.updatedAt)}
              </time>
            </span>
          </span>
        </span>

        <AvatarGroup users={document.collaborators} max={3} size="xs" className="shrink-0" />
      </Link>
    </li>
  )
}

export function DocumentRowSkeleton() {
  return (
    <li className="flex items-center gap-3 px-2 py-2" aria-hidden="true">
      <Skeleton className="size-8" />
      <div className="flex-1 space-y-1.5">
        <Skeleton shape="text" className="h-3.5 w-1/2" />
        <Skeleton shape="text" className="h-3 w-1/3" />
      </div>
      <Skeleton shape="circle" className="size-5" />
    </li>
  )
}
