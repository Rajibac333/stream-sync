import {
  AtSign,
  Bell,
  CheckCheck,
  CircleCheckBig,
  FolderKanban,
  Share2,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Popover } from '@/components/ui/Popover'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from '@/hooks/useNotifications'
import { NotificationType, type AppNotification } from '@/types/notification'
import { formatAbsoluteTime, formatCount, formatRelativeTime } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * Notification centre. (CLAUDE.md §45)
 *
 * Built on Popover rather than Dropdown: the contents are a list of links with
 * a header and actions, not a menu of commands. Forcing it into the menu
 * pattern would mean `role="menuitem"` on things that are links, and arrow-key
 * navigation where Tab is what users expect.
 *
 * All four states are handled — loading, error, empty and populated — because a
 * panel that silently shows nothing is indistinguishable from a broken one.
 * (§59, §60, §61)
 */

const TYPE_ICONS: Record<NotificationType, LucideIcon> = {
  [NotificationType.Mention]: AtSign,
  [NotificationType.TaskAssigned]: UserPlus,
  [NotificationType.DocumentShared]: Share2,
  [NotificationType.TaskCompleted]: CircleCheckBig,
  [NotificationType.ProjectUpdate]: FolderKanban,
}

function NotificationRow({
  notification,
  onActivate,
}: {
  notification: AppNotification
  onActivate: () => void
}) {
  const Icon = TYPE_ICONS[notification.type]

  const body = (
    <>
      <span className="relative mt-0.5 shrink-0">
        {notification.actor ? (
          <Avatar
            size="sm"
            name={notification.actor.name}
            userId={notification.actor.id}
            src={notification.actor.avatarUrl}
          />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full bg-surface-muted text-foreground-subtle">
            <Icon className="size-3" aria-hidden="true" />
          </span>
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'text-body',
            notification.read ? 'text-foreground-muted' : 'font-medium text-foreground',
          )}
        >
          {notification.title}
        </span>

        {notification.body ? (
          <span className="line-clamp-2 text-small text-foreground-muted">{notification.body}</span>
        ) : null}

        <time
          dateTime={notification.createdAt}
          title={formatAbsoluteTime(notification.createdAt)}
          className="text-caption text-foreground-subtle"
        >
          {formatRelativeTime(notification.createdAt)}
        </time>
      </span>

      {!notification.read ? (
        <span
          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
          // The unread state is already carried by the text below; this dot is
          // reinforcement, not the only signal.
          aria-hidden="true"
        />
      ) : null}
    </>
  )

  const rowClasses = cn(
    'flex w-full items-start gap-2.5 px-3 py-2.5 text-left',
    'transition-colors duration-(--duration-fast) hover:bg-surface-hover',
    'outline-none focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
    !notification.read && 'bg-primary-subtle/40',
  )

  return (
    <li className="border-b border-border-subtle last:border-b-0">
      {/* A notification pointing somewhere is a link; one that does not is a
          button that only marks itself read. Same row, honest semantics. */}
      {notification.href ? (
        <Link to={notification.href} onClick={onActivate} className={rowClasses}>
          {body}
          <span className="sr-only">{notification.read ? '' : ' — unread'}</span>
        </Link>
      ) : (
        <button type="button" onClick={onActivate} className={rowClasses}>
          {body}
          <span className="sr-only">{notification.read ? '' : ' — unread'}</span>
        </button>
      )}
    </li>
  )
}

function NotificationSkeleton() {
  return (
    <li className="flex items-start gap-2.5 border-b border-border-subtle px-3 py-2.5 last:border-b-0">
      <Skeleton shape="circle" className="size-6 shrink-0" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton shape="text" className="h-3.5 w-4/5" />
        <Skeleton shape="text" className="h-3 w-2/5" />
      </div>
    </li>
  )
}

export function NotificationsMenu() {
  const { data: notifications, isPending, isError, error, refetch } = useNotifications()
  const unreadCount = useUnreadNotificationCount()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

  return (
    <Popover
      label="Notifications"
      align="end"
      className="w-88 max-w-[calc(100vw-1.5rem)]"
      trigger={
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications, none unread'
          }
        >
          <Bell aria-hidden="true" />

          {unreadCount > 0 ? (
            <span
              aria-hidden="true"
              className={cn(
                'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center',
                'rounded-full bg-primary px-1 text-[0.625rem] font-semibold tabular-nums',
                'text-primary-foreground ring-2 ring-background',
              )}
            >
              {formatCount(unreadCount, 9)}
            </span>
          ) : null}
        </Button>
      }
    >
      {(close) => (
        <div className="flex max-h-[min(30rem,70dvh)] flex-col">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h2 className="text-body font-semibold text-foreground">Notifications</h2>

            {/* No tooltip: the button already says what it does, and a tooltip
                repeating its own label is noise. */}
            {unreadCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllRead.mutate()}
                loading={markAllRead.isPending}
                loadingLabel="Marking all as read"
                leadingIcon={<CheckCheck aria-hidden="true" />}
              >
                Mark all read
              </Button>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isPending ? (
              <ul aria-busy="true">
                <span className="sr-only" role="status">
                  Loading notifications
                </span>
                <NotificationSkeleton />
                <NotificationSkeleton />
                <NotificationSkeleton />
              </ul>
            ) : isError ? (
              <ErrorState
                size="inline"
                title="Couldn’t load notifications"
                error={error}
                onRetry={() => void refetch()}
              />
            ) : notifications.length === 0 ? (
              <EmptyState
                size="inline"
                icon={<Bell />}
                title="You’re all caught up"
                description="Mentions, task assignments and shares will show up here."
              />
            ) : (
              <ul>
                {notifications.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    onActivate={() => {
                      if (!notification.read) markRead.mutate(notification.id)
                      close()
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Popover>
  )
}
