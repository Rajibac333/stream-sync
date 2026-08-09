import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { WorkspaceRole } from '@/types/auth'
import type { WorkspaceMember } from '@/types/workspace'
import type { CollaboratorPresence } from '@/types/dashboard'
import { cn } from '@/utils/cn'

/** Workspace roster and live collaborator presence. (CLAUDE.md §26, §31) */

const ROLE_VARIANT: Record<WorkspaceRole, 'primary' | 'neutral' | 'outline'> = {
  [WorkspaceRole.Owner]: 'primary',
  [WorkspaceRole.Editor]: 'neutral',
  [WorkspaceRole.Viewer]: 'outline',
}

export function MemberList({ members }: { members: readonly WorkspaceMember[] }) {
  return (
    <ul className="flex flex-col">
      {members.map((member) => (
        <li key={member.id} className="flex items-center gap-2.5 rounded-md px-2 py-2">
          <Avatar
            size="sm"
            name={member.user.name}
            userId={member.user.id}
            src={member.user.avatarUrl}
          />

          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body text-foreground">{member.user.name}</span>
            {member.user.title ? (
              <span className="truncate text-caption text-foreground-subtle">
                {member.user.title}
              </span>
            ) : null}
          </span>

          <Badge size="sm" variant={ROLE_VARIANT[member.role]} className="shrink-0 capitalize">
            {member.role}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

/**
 * Who is around right now.
 *
 * Presence is genuinely live in Milestone 6; today it is served by the API.
 * The status is announced through the Avatar's accessible name as well as the
 * dot, so it does not depend on colour perception. (§35)
 */
export function CollaboratorList({
  collaborators,
}: {
  collaborators: readonly CollaboratorPresence[]
}) {
  return (
    <ul className="flex flex-col">
      {collaborators.map(({ user, status, activity }) => (
        <li key={user.id} className="flex items-center gap-2.5 rounded-md px-2 py-2">
          <Avatar
            size="sm"
            name={user.name}
            userId={user.id}
            src={user.avatarUrl}
            status={status}
          />

          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body text-foreground">{user.name}</span>
            <span
              className={cn(
                'truncate text-caption',
                status === 'online' ? 'text-foreground-muted' : 'text-foreground-subtle',
              )}
            >
              {activity ?? (status === 'offline' ? 'Offline' : 'Idle')}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function PersonListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex items-center gap-2.5 px-2 py-2">
          <Skeleton shape="circle" className="size-6" />
          <div className="flex-1 space-y-1.5">
            <Skeleton shape="text" className="h-3.5 w-1/3" />
            <Skeleton shape="text" className="h-3 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  )
}
