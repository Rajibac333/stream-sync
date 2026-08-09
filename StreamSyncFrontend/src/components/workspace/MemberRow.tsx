import { MailCheck, Trash2 } from 'lucide-react'

import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { WorkspaceRole } from '@/types/auth'
import { MemberStatus, type WorkspaceMember } from '@/types/workspace'
import { formatAbsoluteTime, formatRelativeTime } from '@/utils/format'

/**
 * One person in the workspace roster. (CLAUDE.md §26)
 *
 * The role control is a real `<select>` rather than a menu, because changing a
 * role is picking one value from three — and the native control brings the
 * platform picker on mobile, which is where a roster is most awkward to use.
 *
 * Removal is a separate button, not a fourth option in the role select. Mixing
 * a destructive action into a list of non-destructive ones means one mis-click
 * on a small screen revokes somebody's access.
 */

const ROLE_OPTIONS = [
  { value: WorkspaceRole.Owner, label: 'Owner' },
  { value: WorkspaceRole.Editor, label: 'Editor' },
  { value: WorkspaceRole.Viewer, label: 'Viewer' },
]

const ROLE_VARIANT: Record<WorkspaceRole, 'primary' | 'neutral' | 'outline'> = {
  owner: 'primary',
  editor: 'neutral',
  viewer: 'outline',
}

export interface MemberRowProps {
  member: WorkspaceMember
  /** False for a Viewer or Editor — they see the roster, they cannot change it. */
  canManage: boolean
  /** True for the signed-in user's own row. */
  isSelf: boolean
  busy: boolean
  onRoleChange: (role: WorkspaceRole) => void
  onRemove: () => void
}

export function MemberRow({
  member,
  canManage,
  isSelf,
  busy,
  onRoleChange,
  onRemove,
}: MemberRowProps) {
  const invited = member.status === MemberStatus.Invited

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border-subtle py-3 last:border-b-0">
      <Avatar
        size="md"
        name={member.user.name}
        userId={member.user.id}
        src={member.user.avatarUrl}
      />

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-body text-foreground">
          {member.user.name}
          {isSelf ? <span className="text-caption text-foreground-subtle">(you)</span> : null}
        </p>
        <p className="truncate text-caption text-foreground-muted">{member.user.email}</p>
      </div>

      {invited ? (
        <Badge size="sm" variant="warning" icon={<MailCheck aria-hidden="true" />}>
          Invited
        </Badge>
      ) : (
        <span className="hidden text-caption text-foreground-subtle sm:block">
          Joined{' '}
          <time dateTime={member.joinedAt} title={formatAbsoluteTime(member.joinedAt)}>
            {formatRelativeTime(member.joinedAt)}
          </time>
        </span>
      )}

      {canManage ? (
        <div className="flex shrink-0 items-center gap-1">
          <Select
            label={`Role for ${member.user.name}`}
            hideLabel
            options={ROLE_OPTIONS}
            value={member.role}
            disabled={busy}
            onChange={(event) => onRoleChange(event.target.value as WorkspaceRole)}
            containerClassName="w-32"
          />
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={onRemove}
            aria-label={`Remove ${member.user.name} from this workspace`}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <Badge size="sm" variant={ROLE_VARIANT[member.role]} className="shrink-0 capitalize">
          {member.role}
        </Badge>
      )}
    </li>
  )
}
