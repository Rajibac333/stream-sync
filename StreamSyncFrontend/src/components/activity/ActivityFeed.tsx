import {
  CircleCheckBig,
  FileText,
  FolderKanban,
  MessageSquare,
  Sparkles,
  SquarePen,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import { Avatar } from '@/components/ui/Avatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { ACTIVITY_VERBS, ActivityAction, type ActivityEvent } from '@/types/activity'
import { formatAbsoluteTime, formatRelativeTime } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * Chronological activity timeline. (CLAUDE.md §44)
 *
 * Rendered as an ordered list — the order is the information, and <ol> says so.
 * The connecting rail is drawn with a border on the list item rather than an
 * absolutely-positioned element, so it stretches with content instead of
 * needing a fixed row height.
 */

const ACTION_ICONS: Record<ActivityAction, LucideIcon> = {
  project_created: FolderKanban,
  document_created: FileText,
  document_edited: SquarePen,
  task_created: SquarePen,
  task_completed: CircleCheckBig,
  member_invited: UserPlus,
  comment_added: MessageSquare,
  ai_action: Sparkles,
}

const ACTION_TONES: Partial<Record<ActivityAction, string>> = {
  task_completed: 'text-success',
  ai_action: 'text-primary',
}

function ActivityItem({ event, isLast }: { event: ActivityEvent; isLast: boolean }) {
  const Icon = ACTION_ICONS[event.action]

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* Rail. Decorative, and stops at the last item so the timeline reads as
          finished rather than trailing off. */}
      {!isLast ? (
        <span
          aria-hidden="true"
          className="absolute left-[0.6875rem] top-7 bottom-1 w-px bg-border"
        />
      ) : null}

      <span className="relative shrink-0">
        <Avatar size="sm" name={event.actor.name} userId={event.actor.id} src={event.actor.avatarUrl} />
        <span
          aria-hidden="true"
          className={cn(
            'absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full',
            'border border-border bg-surface',
            ACTION_TONES[event.action] ?? 'text-foreground-subtle',
          )}
        >
          <Icon className="size-2" />
        </span>
      </span>

      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-small text-foreground-muted">
          <span className="font-medium text-foreground">{event.actor.name}</span>{' '}
          {ACTIVITY_VERBS[event.action]}{' '}
          {event.target.href ? (
            <Link
              to={event.target.href}
              className="rounded-xs font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
            >
              {event.target.name}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{event.target.name}</span>
          )}
        </p>

        {event.context ? (
          <p className="mt-0.5 line-clamp-2 text-caption text-foreground-subtle">{event.context}</p>
        ) : null}

        <time
          dateTime={event.createdAt}
          title={formatAbsoluteTime(event.createdAt)}
          className="mt-0.5 block text-caption text-foreground-subtle"
        >
          {formatRelativeTime(event.createdAt)}
        </time>
      </div>
    </li>
  )
}

export function ActivityFeed({ events }: { events: readonly ActivityEvent[] }) {
  return (
    <ol className="flex flex-col">
      {events.map((event, index) => (
        <ActivityItem key={event.id} event={event} isLast={index === events.length - 1} />
      ))}
    </ol>
  )
}

export function ActivityFeedSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton shape="circle" className="size-6 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton shape="text" className="h-3.5 w-4/5" />
            <Skeleton shape="text" className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}
