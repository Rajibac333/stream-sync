import { History, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueryState } from '@/components/ui/QueryState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useDocumentVersions } from '@/hooks/useDocumentSession'
import { useRestoreVersion } from '@/hooks/useContentMutations'
import type { DocumentVersion } from '@/types/document'
import { formatAbsoluteTime, formatRelativeTime } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * Version history. (CLAUDE.md §41)
 *
 * Version, author, time and change summary — the four columns §41 specifies —
 * as a timeline rather than a table, because on a 320px screen a four-column
 * table is unreadable and this needs to work there too.
 *
 * Restore is behind a confirmation, as §41 requires: it overwrites the live
 * document for everyone currently in it, which is not something to trigger on
 * a mis-click.
 *
 * It is applied as a *forward* write — the restored text becomes the newest
 * version — rather than by deleting history. Rewriting the past would make the
 * timeline lie about what happened, and this is the one operation where a user
 * most needs to be able to undo their undo.
 */

function VersionRow({
  version,
  onRestore,
}: {
  version: DocumentVersion
  onRestore: (version: DocumentVersion) => void
}) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* Timeline rail, stopping at the last entry. */}
      <span
        aria-hidden="true"
        className="absolute bottom-1 left-[0.6875rem] top-7 w-px bg-border last:hidden"
      />

      <Avatar
        size="sm"
        name={version.author.name}
        userId={version.author.id}
        src={version.author.avatarUrl}
        className="relative shrink-0"
      />

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-small font-medium text-foreground">Version {version.number}</span>
          {version.isCurrent ? (
            <span className="rounded-sm bg-primary-subtle px-1.5 py-px text-caption font-medium text-primary-subtle-foreground">
              Current
            </span>
          ) : null}
        </p>

        <p className="mt-0.5 text-small text-foreground-muted">{version.summary}</p>

        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-caption text-foreground-subtle">
          <span>{version.author.name}</span>
          <time dateTime={version.createdAt} title={formatAbsoluteTime(version.createdAt)}>
            {formatRelativeTime(version.createdAt)}
          </time>
        </p>

        {!version.isCurrent ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1.5"
            leadingIcon={<RotateCcw aria-hidden="true" />}
            onClick={() => onRestore(version)}
          >
            Restore
          </Button>
        ) : null}
      </div>
    </li>
  )
}

export function VersionHistoryPanel({ documentId }: { documentId: string }) {
  const versionsQuery = useDocumentVersions(documentId)
  const restore = useRestoreVersion(documentId)
  const [pendingRestore, setPendingRestore] = useState<DocumentVersion | null>(null)

  return (
    <div className="h-full overflow-y-auto p-3">
      <QueryState
        query={versionsQuery}
        errorTitle="Couldn't load history"
        loading={
          <div className="flex flex-col gap-4" aria-busy="true">
            <span className="sr-only" role="status">
              Loading version history
            </span>
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex gap-3">
                <Skeleton shape="circle" className="size-6 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton shape="text" className="h-3.5 w-24" />
                  <Skeleton shape="text" className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        }
        empty={
          <EmptyState
            size="inline"
            icon={<History />}
            title="No history yet"
            description="Versions are recorded as the document is edited."
          />
        }
      >
        {(versions) => (
          <ol className={cn('flex flex-col')}>
            {versions.map((version) => (
              <VersionRow key={version.id} version={version} onRestore={setPendingRestore} />
            ))}
          </ol>
        )}
      </QueryState>

      <Dialog
        open={pendingRestore !== null}
        onOpenChange={() => setPendingRestore(null)}
        title={`Restore version ${pendingRestore?.number ?? ''}?`}
        description="This replaces the current document for everyone with access. The version you are replacing is kept in history."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingRestore(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={restore.isPending}
              loadingLabel="Restoring"
              onClick={() => {
                if (!pendingRestore) return
                restore.mutate(
                  { versionId: pendingRestore.id, versionNumber: pendingRestore.number },
                  { onSettled: () => setPendingRestore(null) },
                )
              }}
            >
              Restore
            </Button>
          </>
        }
      />
    </div>
  )
}
