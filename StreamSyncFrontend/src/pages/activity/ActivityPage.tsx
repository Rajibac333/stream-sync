import { Activity as ActivityIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ActivityFeed, ActivityFeedSkeleton } from '@/components/activity/ActivityFeed'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueryState } from '@/components/ui/QueryState'
import { Select } from '@/components/ui/Select'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { useActivity, useMembers } from '@/hooks/useWorkspaceContent'
import { ActivityAction, type ActivityEvent } from '@/types/activity'
import { formatAbsoluteTime } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * Workspace activity. (CLAUDE.md §44)
 *
 * A chronological timeline of everything §44 lists, grouped by day. Grouping
 * matters more than it sounds: an ungrouped feed of eighty entries gives no
 * sense of *when*, and "3 hours ago" stops being useful past the first screen.
 *
 * Filtering is client-side over the already-fetched list, which is honest for
 * the sizes involved and moves server-side with a `?action=` parameter when it
 * stops being. The shape of the change is the same one the documents list will
 * need.
 */

const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All activity' },
  { value: ActivityAction.DocumentEdited, label: 'Document edits' },
  { value: ActivityAction.DocumentCreated, label: 'Documents created' },
  { value: ActivityAction.TaskCompleted, label: 'Tasks completed' },
  { value: ActivityAction.TaskCreated, label: 'Tasks created' },
  { value: ActivityAction.CommentAdded, label: 'Comments' },
  { value: ActivityAction.ProjectCreated, label: 'Projects created' },
  { value: ActivityAction.MemberInvited, label: 'Members' },
  { value: ActivityAction.AiAction, label: 'AI actions' },
]

/** "Today" / "Yesterday" / a written date — never a bare ISO string. */
function dayLabel(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDay(date, today)) return 'Today'
  if (sameDay(date, yesterday)) return 'Yesterday'

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)
}

function groupByDay(events: readonly ActivityEvent[]): { label: string; events: ActivityEvent[] }[] {
  const groups: { label: string; events: ActivityEvent[] }[] = []

  for (const event of events) {
    const label = dayLabel(event.createdAt)
    const last = groups.at(-1)
    if (last && last.label === label) last.events.push(event)
    else groups.push({ label, events: [event] })
  }

  return groups
}

export function ActivityPage() {
  const { workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null

  const activityQuery = useActivity(workspaceId)
  const { data: members } = useMembers(workspaceId)

  const [action, setAction] = useState('all')
  const [actorId, setActorId] = useState('all')

  const actorOptions = useMemo(
    () => [
      { value: 'all', label: 'Everyone' },
      ...(members ?? []).map((member) => ({ value: member.user.id, label: member.user.name })),
    ],
    [members],
  )

  const visible = (events: ActivityEvent[]) =>
    events.filter(
      (event) =>
        (action === 'all' || event.action === action) &&
        (actorId === 'all' || event.actor.id === actorId),
    )

  const filtered = action !== 'all' || actorId !== 'all'
  const clearFilters = () => {
    setAction('all')
    setActorId('all')
  }

  return (
    <div className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-h1 text-foreground">Activity</h1>
        <p className="mt-1 text-body text-foreground-muted">
          Everything that has happened in {workspace?.name ?? 'this workspace'}.
        </p>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Select
          label="Filter by type"
          hideLabel
          options={ACTION_FILTERS}
          value={action}
          onChange={(event) => setAction(event.target.value)}
          containerClassName="w-48"
        />
        <Select
          label="Filter by person"
          hideLabel
          options={actorOptions}
          value={actorId}
          onChange={(event) => setActorId(event.target.value)}
          containerClassName="w-44"
        />
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10">
        <QueryState
          query={activityQuery}
          isEmpty={(events) => visible(events).length === 0}
          errorTitle="Couldn't load activity"
          loading={<ActivityFeedSkeleton rows={8} />}
          empty={
            filtered ? (
              <EmptyState
                icon={<ActivityIcon />}
                title="Nothing matches"
                description="No activity matches the current filters."
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<ActivityIcon />}
                title="No activity yet"
                description="Edits, comments, completed tasks and AI actions all show up here."
              />
            )
          }
        >
          {(events) => {
            const results = visible(events)

            return (
              <div className="min-w-0">
                {/* Announced politely so a filter change reports its result
                    without the whole list being re-read. */}
                <p role="status" className="sr-only">
                  {results.length} {results.length === 1 ? 'event' : 'events'}
                </p>

                <div className="flex flex-col gap-7">
                  {groupByDay(results).map((group) => (
                    <section key={group.label} aria-label={group.label}>
                      <h2
                        className={cn(
                          'sticky top-topbar z-10 -mx-1 mb-3 bg-background/90 px-1 py-1',
                          'text-caption font-medium uppercase tracking-wide text-foreground-subtle',
                          'backdrop-blur-sm',
                        )}
                      >
                        {group.label}
                      </h2>
                      <ActivityFeed events={group.events} />
                    </section>
                  ))}
                </div>
              </div>
            )
          }}
        </QueryState>

        {/* -------------------------------------------------------------
            Who's been active — presence-adjacent context. (§31, §35)
           ------------------------------------------------------------- */}
        <aside className="lg:w-64" aria-label="Contributors">
          <h2 className="mb-3 text-body font-semibold text-foreground">Contributors</h2>

          <QueryState
            query={activityQuery}
            errorTitle="Couldn't load contributors"
            loading={<ActivityFeedSkeleton rows={3} />}
            empty={<p className="text-caption text-foreground-subtle">Nobody yet.</p>}
          >
            {(events) => {
              const counts = new Map<string, { name: string; avatarUrl: string | null; count: number; last: string }>()

              for (const event of events) {
                const existing = counts.get(event.actor.id)
                if (existing) existing.count += 1
                else
                  counts.set(event.actor.id, {
                    name: event.actor.name,
                    avatarUrl: event.actor.avatarUrl,
                    count: 1,
                    last: event.createdAt,
                  })
              }

              const ranked = [...counts.entries()].sort((a, b) => b[1].count - a[1].count)

              return (
                <ul className="flex flex-col">
                  {ranked.map(([id, entry]) => (
                    <li key={id} className="flex items-center gap-2.5 rounded-md px-2 py-2">
                      <Avatar size="sm" name={entry.name} userId={id} src={entry.avatarUrl} />
                      <span className="min-w-0 flex-1 truncate text-body text-foreground">
                        {entry.name}
                      </span>
                      <span
                        className="shrink-0 text-caption tabular-nums text-foreground-subtle"
                        title={`Last active ${formatAbsoluteTime(entry.last)}`}
                      >
                        {entry.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            }}
          </QueryState>
        </aside>
      </div>
    </div>
  )
}
