import { Check, CloudOff, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'

import { Avatar } from '@/components/ui/Avatar'
import { Tooltip } from '@/components/ui/Tooltip'
import {
  editingParticipants,
  sortedForDisplay,
  type ParticipantMap,
} from '@/websocket/presence'
import { ConnectionState, DisconnectReason, PresenceState, SyncState } from '@/websocket/types'
import { formatRelativeTime } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * Presence and save state. (CLAUDE.md §35, §37, §57, §69)
 *
 * Three related signals, kept together because they answer one question — "is
 * my work safe, and who else is here?"
 */

/* -----------------------------------------------------------------------------
 * Collaborator avatars (§35)
 * -------------------------------------------------------------------------- */

/** Avatar presence maps 1:1 onto the states the Avatar primitive already draws. */
const AVATAR_STATUS: Record<PresenceState, 'online' | 'idle' | 'offline' | 'editing'> = {
  online: 'online',
  idle: 'idle',
  offline: 'offline',
  editing: 'editing',
}

const STATE_LABEL: Record<PresenceState, string> = {
  editing: 'editing now',
  online: 'viewing',
  idle: 'idle',
  offline: 'offline',
}

export function CollaboratorAvatars({
  participants,
  max = 4,
  className,
}: {
  participants: ParticipantMap
  max?: number
  className?: string
}) {
  const all = sortedForDisplay(participants)
  const visible = all.slice(0, max)
  const overflow = all.length - visible.length

  if (all.length === 0) return null

  return (
    <ul
      className={cn('flex items-center -space-x-1.5', className)}
      aria-label={`${all.length} ${all.length === 1 ? 'person' : 'people'} in this document`}
    >
      {visible.map((participant) => (
        <li key={participant.user.id}>
          <Tooltip content={`${participant.user.name} — ${STATE_LABEL[participant.state]}`}>
            <span className="inline-flex">
              <Avatar
                size="sm"
                name={participant.user.name}
                userId={participant.user.id}
                src={participant.user.avatarUrl}
                status={AVATAR_STATUS[participant.state]}
                className="ring-2 ring-background"
              />
            </span>
          </Tooltip>
        </li>
      ))}

      {overflow > 0 ? (
        <li>
          <span
            className={cn(
              'flex size-6 items-center justify-center rounded-full ring-2 ring-background',
              'bg-surface-muted text-caption font-medium text-foreground-muted',
            )}
          >
            +{overflow}
          </span>
        </li>
      ) : null}
    </ul>
  )
}

/* -----------------------------------------------------------------------------
 * Typing indicator (§35)
 * -------------------------------------------------------------------------- */

/** "Maria is editing…" / "Maria and Lena are editing…" */
function typingSentence(names: string[]): string {
  const [first, second] = names
  if (names.length === 1 && first) return `${first} is editing…`
  if (names.length === 2 && first && second) return `${first} and ${second} are editing…`
  return `${names.length} people are editing…`
}

export function TypingIndicator({
  participants,
  selfId,
  className,
}: {
  participants: ParticipantMap
  selfId: string
  className?: string
}) {
  const editing = editingParticipants(participants, selfId)
  const names = editing.map((participant) => participant.user.name.split(' ')[0] ?? '')

  return (
    /* The live region is always mounted and only its text changes. A region
       inserted at the same moment as its content is frequently not announced
       at all. `polite` because this must never interrupt someone typing. */
    <p
      aria-live="polite"
      className={cn(
        'flex items-center gap-1.5 text-caption text-foreground-muted',
        'transition-opacity duration-(--duration-normal)',
        editing.length === 0 && 'opacity-0',
        className,
      )}
    >
      {editing.length > 0 ? (
        <>
          <span className="flex gap-0.5" aria-hidden="true">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="size-1 animate-pulse rounded-full bg-foreground-subtle"
                style={{ animationDelay: `${dot * 160}ms` }}
              />
            ))}
          </span>
          {typingSentence(names)}
        </>
      ) : null}
    </p>
  )
}

/* -----------------------------------------------------------------------------
 * Save + connection state (§37, §69)
 * -------------------------------------------------------------------------- */

interface StatusLook {
  label: string
  icon: typeof Check
  tone: string
  spin?: boolean
}

/**
 * Connection is checked *before* save state, deliberately.
 *
 * "Saved" over a dead socket is the single most dangerous thing this badge
 * could say — it tells the user their work is safe when it is sitting in a
 * local queue. Reconnecting always wins.
 */
function resolveStatus(
  connection: ConnectionState,
  sync: SyncState,
  lastSavedAt: string | null,
  disconnectReason: DisconnectReason | null,
): StatusLook {
  /* An expired session is not a network blip, and telling the user to wait for
     a reconnect that will never come is the wrong instruction. The client
     stops retrying on this reason, so the copy has to say what to do. */
  if (disconnectReason === DisconnectReason.AuthFailed) {
    return { label: 'Session expired — reload to sign in', icon: TriangleAlert, tone: 'text-danger' }
  }
  if (connection === ConnectionState.Reconnecting) {
    return { label: 'Reconnecting…', icon: RefreshCw, tone: 'text-warning', spin: true }
  }
  if (connection === ConnectionState.Error || sync === SyncState.Error) {
    return { label: "Couldn't save", icon: TriangleAlert, tone: 'text-danger' }
  }
  if (connection === ConnectionState.Disconnected || sync === SyncState.Offline) {
    return { label: 'Offline — changes queued', icon: CloudOff, tone: 'text-foreground-muted' }
  }
  if (connection === ConnectionState.Connecting) {
    return { label: 'Connecting…', icon: LoaderCircle, tone: 'text-foreground-muted', spin: true }
  }
  if (sync === SyncState.Saving) {
    return { label: 'Saving…', icon: LoaderCircle, tone: 'text-foreground-muted', spin: true }
  }

  return {
    label: lastSavedAt ? `Saved ${formatRelativeTime(lastSavedAt).toLowerCase()}` : 'Synced',
    icon: Check,
    tone: 'text-success',
  }
}

export function SaveStatus({
  connection,
  sync,
  lastSavedAt,
  disconnectReason = null,
  className,
}: {
  connection: ConnectionState
  sync: SyncState
  lastSavedAt: string | null
  disconnectReason?: DisconnectReason | null
  className?: string
}) {
  const { label, icon: Icon, tone, spin } = resolveStatus(
    connection,
    sync,
    lastSavedAt,
    disconnectReason,
  )

  return (
    <p
      // `status`, not `alert`: the user should be told, not interrupted.
      role="status"
      className={cn('flex items-center gap-1.5 text-caption tabular-nums', tone, className)}
    >
      <Icon className={cn('size-3.5 shrink-0', spin && 'animate-spin')} aria-hidden="true" />
      {label}
    </p>
  )
}
