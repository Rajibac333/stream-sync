import { cva, type VariantProps } from 'class-variance-authority'
import { useState } from 'react'
import type { HTMLAttributes } from 'react'

import { getInitials, getPresenceColorIndex } from '@/utils/identity'
import { cn } from '@/utils/cn'

/**
 * Avatar
 *
 * Renders initials on a deterministic presence colour, with the image layered
 * on top. If the image 404s the initials are already underneath, so a broken
 * avatar degrades to a correct one rather than to an empty circle.
 *
 * CLAUDE.md §15 (avatars are the one intentionally circular element), §35
 */

const avatarVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium select-none',
  {
    variants: {
      size: {
        xs: 'size-5 text-[0.5625rem]',
        sm: 'size-6 text-caption',
        md: 'size-8 text-caption',
        lg: 'size-10 text-small',
        xl: 'size-16 text-h3',
      },
    },
    defaultVariants: { size: 'md' },
  },
)

const PRESENCE_BACKGROUNDS = [
  'bg-presence-1/15 text-presence-1',
  'bg-presence-2/15 text-presence-2',
  'bg-presence-3/15 text-presence-3',
  'bg-presence-4/15 text-presence-4',
  'bg-presence-5/15 text-presence-5',
  'bg-presence-6/15 text-presence-6',
  'bg-presence-7/15 text-presence-7',
  'bg-presence-8/15 text-presence-8',
] as const

/** Presence states from CLAUDE.md §35. */
export type PresenceStatus = 'online' | 'idle' | 'offline' | 'editing'

const STATUS_STYLES: Record<PresenceStatus, { className: string; label: string }> = {
  online: { className: 'bg-success', label: 'Online' },
  idle: { className: 'bg-warning', label: 'Idle' },
  offline: { className: 'bg-muted', label: 'Offline' },
  editing: { className: 'bg-primary', label: 'Editing' },
}

const STATUS_SIZES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'size-1.5 ring-1',
  sm: 'size-2 ring-2',
  md: 'size-2.5 ring-2',
  lg: 'size-3 ring-2',
  xl: 'size-4 ring-[3px]',
}

export interface AvatarProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof avatarVariants> {
  /** Display name — drives initials and the accessible name. */
  name: string
  src?: string | null
  /** Stable id used to pick the presence colour. Defaults to `name`. */
  userId?: string
  status?: PresenceStatus
}

export function Avatar({
  name,
  src,
  userId,
  status,
  size = 'md',
  className,
  ...props
}: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false)

  const colorIndex = getPresenceColorIndex(userId ?? name)
  const colorClass = PRESENCE_BACKGROUNDS[colorIndex - 1] ?? PRESENCE_BACKGROUNDS[0]
  const showImage = Boolean(src) && !imageFailed

  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={cn(avatarVariants({ size }), colorClass, className)}
        // One accessible name for the whole thing; the <img> below is marked
        // decorative so it is not announced twice.
        role="img"
        aria-label={status ? `${name} — ${STATUS_STYLES[status].label}` : name}
        {...props}
      >
        <span aria-hidden="true">{getInitials(name)}</span>

        {showImage ? (
          <img
            src={src ?? undefined}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
      </span>

      {status ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -bottom-px -right-px rounded-full ring-background',
            STATUS_SIZES[size ?? 'md'],
            STATUS_STYLES[status].className,
          )}
        />
      ) : null}
    </span>
  )
}

export interface AvatarGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Collaborators, most relevant first. */
  users: readonly { id: string; name: string; avatarUrl?: string | null }[]
  max?: number
  size?: AvatarProps['size']
}

/** Overlapping stack of collaborators with a `+n` overflow chip. (CLAUDE.md §35) */
export function AvatarGroup({
  users,
  max = 4,
  size = 'md',
  className,
  ...props
}: AvatarGroupProps) {
  const visible = users.slice(0, max)
  const overflow = users.length - visible.length

  return (
    <div
      className={cn('flex items-center -space-x-1.5', className)}
      role="group"
      aria-label={`${users.length} ${users.length === 1 ? 'collaborator' : 'collaborators'}`}
      {...props}
    >
      {visible.map((user) => (
        <Avatar
          key={user.id}
          name={user.name}
          userId={user.id}
          src={user.avatarUrl ?? null}
          size={size}
          className="ring-2 ring-background"
        />
      ))}

      {overflow > 0 ? (
        <span
          className={cn(
            avatarVariants({ size }),
            'bg-surface-muted text-foreground-muted ring-2 ring-background',
          )}
          role="img"
          aria-label={`${overflow} more`}
        >
          <span aria-hidden="true">+{overflow}</span>
        </span>
      ) : null}
    </div>
  )
}
