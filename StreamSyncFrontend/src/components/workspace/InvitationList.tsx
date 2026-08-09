import { Mail } from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAcceptInvitation } from '@/hooks/useWorkspaces'
import { toast } from '@/store/toastStore'
import type { PendingInvitation } from '@/types/workspace'

/**
 * Invitations waiting for the signed-in user. (CLAUDE.md §28)
 *
 * Deliberately not tucked into a menu. A workspace nobody has joined is absent
 * from the switcher by design, so if this list is not on screen the invitation
 * is a notification pointing at nothing — which is exactly where an invited
 * teammate gets stuck.
 */

export interface InvitationListProps {
  invitations: readonly PendingInvitation[]
}

export function InvitationList({ invitations }: InvitationListProps) {
  const accept = useAcceptInvitation()

  if (invitations.length === 0) return null

  return (
    <section
      aria-labelledby="invitations-heading"
      className="rounded-xl border border-border bg-surface p-4 sm:p-5"
    >
      <div className="mb-3 flex items-center gap-2">
        <Mail className="size-4 text-foreground-muted" aria-hidden="true" />
        <h2 id="invitations-heading" className="text-body font-medium text-foreground">
          {invitations.length === 1 ? 'You have an invitation' : 'You have invitations'}
        </h2>
      </div>

      <ul className="flex flex-col">
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-wrap items-center gap-3 border-b border-border-subtle py-3 last:border-b-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-body text-foreground">{invitation.workspaceName}</p>
              <p className="truncate text-caption text-foreground-muted">
                {/* Who invited you is part of the decision, not decoration. */}
                {invitation.invitedBy
                  ? `${invitation.invitedBy.name} invited you`
                  : 'You were invited'}
              </p>
            </div>

            <Badge size="sm" variant="outline" className="capitalize">
              {invitation.role}
            </Badge>

            <Button
              size="sm"
              // One in-flight accept at a time: the list re-renders on success,
              // and a second click during that window targets a row that is
              // about to disappear.
              disabled={accept.isPending}
              onClick={() =>
                accept.mutate(invitation.workspaceId, {
                  onSuccess: () =>
                    toast.success({
                      title: `You joined ${invitation.workspaceName}`,
                    }),
                  onError: () => toast.error({ title: "Couldn't accept that invitation" }),
                })
              }
            >
              Accept
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
