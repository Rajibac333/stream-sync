import { Users } from 'lucide-react'
import { useState } from 'react'

import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueryState } from '@/components/ui/QueryState'
import { InviteMemberForm } from '@/components/workspace/InviteMemberForm'
import { MemberRow } from '@/components/workspace/MemberRow'
import { PersonListSkeleton } from '@/components/workspace/MemberList'
import { useCurrentUser } from '@/hooks/useAuth'
import { useRemoveMember, useUpdateMemberRole } from '@/hooks/useMemberMutations'
import { useMembers } from '@/hooks/useWorkspaceContent'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { WorkspaceRole } from '@/types/auth'
import type { WorkspaceMember } from '@/types/workspace'

/**
 * Workspace members. (CLAUDE.md §24, §26, §27)
 *
 * Who is in the workspace, what they can do, and — for an owner — the controls
 * to change it.
 *
 * PERMISSIONS ARE UX HERE, NOT SECURITY
 *
 * Only an Owner sees the invite form and the per-row controls. That is a
 * convenience: it keeps a Viewer from clicking something that will only come
 * back as a 403. The decision that matters is Django's, and this screen assumes
 * nothing about having made it. §26 is explicit, and it is worth repeating on
 * the one screen where the temptation to treat the client as the gate is
 * strongest.
 */

export function MembersPage() {
  const user = useCurrentUser()
  const { workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null

  const membersQuery = useMembers(workspaceId)
  const updateRole = useUpdateMemberRole(workspaceId ?? '')
  const removeMember = useRemoveMember(workspaceId ?? '')

  const [pendingRemoval, setPendingRemoval] = useState<WorkspaceMember | null>(null)

  const canManage = workspace?.role === WorkspaceRole.Owner
  const busy = updateRole.isPending || removeMember.isPending

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header>
        <h1 className="text-h1 text-foreground">Members</h1>
        <p className="mt-1 text-body text-foreground-muted">
          Who can see and change work in {workspace?.name ?? 'this workspace'}.
        </p>
      </header>

      {canManage ? (
        <section aria-labelledby="invite-heading" className="mt-6">
          <h2 id="invite-heading" className="sr-only">
            Invite a teammate
          </h2>
          {workspaceId ? <InviteMemberForm workspaceId={workspaceId} /> : null}
        </section>
      ) : (
        <Alert variant="info" className="mt-6">
          You have {workspace?.role ?? 'limited'} access to this workspace. Only an owner can
          invite people or change roles.
        </Alert>
      )}

      <section aria-labelledby="roster-heading" className="mt-8">
        <QueryState
          query={membersQuery}
          errorTitle="Couldn't load members"
          loading={
            <div aria-busy="true">
              <span className="sr-only" role="status">
                Loading members
              </span>
              <PersonListSkeleton rows={4} />
            </div>
          }
          empty={
            <EmptyState
              icon={<Users />}
              title="Nobody here yet"
              description={
                canManage
                  ? 'Invite a teammate above and they will appear here.'
                  : 'This workspace has no other members.'
              }
            />
          }
        >
          {(members) => (
            <>
              <h2
                id="roster-heading"
                className="mb-1 text-small font-medium text-foreground-muted"
              >
                {members.length} {members.length === 1 ? 'person' : 'people'}
              </h2>

              <ul className="rounded-lg border border-border bg-surface px-3">
                {members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    canManage={canManage}
                    isSelf={member.user.id === user.id}
                    busy={busy}
                    onRoleChange={(role) => updateRole.mutate({ memberId: member.id, role })}
                    onRemove={() => setPendingRemoval(member)}
                  />
                ))}
              </ul>
            </>
          )}
        </QueryState>
      </section>

      {/* Removal is destructive and irreversible from here, so it is confirmed
          and the button says what it will do rather than "OK". (§74) */}
      <Dialog
        open={pendingRemoval !== null}
        onOpenChange={() => setPendingRemoval(null)}
        title={`Remove ${pendingRemoval?.user.name ?? ''}?`}
        description="They lose access to every project, document and task in this workspace. Anything they created stays."
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setPendingRemoval(null)}
              disabled={removeMember.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={removeMember.isPending}
              loadingLabel="Removing"
              onClick={() => {
                if (!pendingRemoval) return
                removeMember.mutate(
                  { memberId: pendingRemoval.id, name: pendingRemoval.user.name },
                  { onSuccess: () => setPendingRemoval(null) },
                )
              }}
            >
              Remove access
            </Button>
          </>
        }
      />
    </div>
  )
}
