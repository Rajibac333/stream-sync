import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Link2, UserPlus } from 'lucide-react'
import { useState } from 'react'

import { documentsApi } from '@/api/documents'
import { queryKeys } from '@/api/queryKeys'
import { Alert } from '@/components/ui/Alert'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { QueryState } from '@/components/ui/QueryState'
import { Select } from '@/components/ui/Select'
import { PersonListSkeleton } from '@/components/workspace/MemberList'
import { useDocumentShares } from '@/hooks/useDocumentSession'
import { toast } from '@/store/toastStore'
import { WorkspaceRole } from '@/types/auth'
import type { DocumentShareEntry } from '@/types/document'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Share dialog. (CLAUDE.md §38, §26)
 *
 * Invite, change role, remove access, and see who already has it.
 *
 * The role select on each row is disabled for the Owner: a document with no
 * owner has nobody who can grant access, and demoting the last one is a
 * one-way door. That is a UX guard only — §26 is explicit that the real check
 * belongs to Django, and a client that hides a control has not enforced
 * anything.
 */

const ROLE_OPTIONS = [
  { value: WorkspaceRole.Editor, label: 'Editor' },
  { value: WorkspaceRole.Viewer, label: 'Viewer' },
]

const ROLE_HINT: Record<WorkspaceRole, string> = {
  owner: 'Full access, including sharing',
  editor: 'Can edit and comment',
  viewer: 'Can read and comment',
}

export interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentId: string
  documentTitle: string
}

export function ShareDialog({ open, onOpenChange, documentId, documentTitle }: ShareDialogProps) {
  const queryClient = useQueryClient()
  const sharesQuery = useDocumentShares(documentId, open)

  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>(WorkspaceRole.Editor)
  const [copied, setCopied] = useState(false)

  const updateRole = useMutation({
    mutationFn: ({ shareId, role }: { shareId: string; role: WorkspaceRole }) =>
      documentsApi.updateShareRole(documentId, shareId, role),
    onSuccess: (entries) => {
      queryClient.setQueryData(queryKeys.documents.shares(documentId), entries)
    },
    onError: () => toast.error({ title: "Couldn't change that role" }),
  })

  const invite = () => {
    const trimmed = email.trim()
    if (trimmed === '') return

    // Inviting creates a membership and sends mail, which needs the workspace
    // permission model. Said plainly rather than faking a row that would vanish
    // on reload. (Rule 10)
    toast.show({
      title: "Invitations aren’t built yet",
      description: `${trimmed} would be invited as ${inviteRole}.`,
    })
    setEmail('')
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied; the URL is in the address bar anyway.
      toast.warning({ title: "Couldn't copy the link", description: 'Copy it from the address bar.' })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Share “${documentTitle}”`}
      size="lg"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => void copyLink()}
            leadingIcon={copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
            className="mr-auto"
          >
            {copied ? 'Link copied' : 'Copy link'}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        {/* ---------------------------------------------------------------
            Invite
           --------------------------------------------------------------- */}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            invite()
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <Input
            label="Invite by email"
            type="email"
            placeholder="teammate@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            containerClassName="min-w-48 flex-1"
          />
          <Select
            label="Role"
            hideLabel
            options={ROLE_OPTIONS}
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value)}
            containerClassName="w-32"
          />
          <Button type="submit" variant="primary" leadingIcon={<UserPlus aria-hidden="true" />}>
            Invite
          </Button>
        </form>

        {/* ---------------------------------------------------------------
            Who has access
           --------------------------------------------------------------- */}
        <section aria-labelledby="share-access-heading">
          <h3 id="share-access-heading" className="mb-2 text-small font-medium text-foreground">
            People with access
          </h3>

          <QueryState
            query={sharesQuery}
            errorTitle="Couldn't load access"
            loading={<PersonListSkeleton rows={3} />}
            empty={
              <EmptyState size="inline" title="Nobody else has access" description="Invite a teammate above." />
            }
          >
            {(shares: DocumentShareEntry[]) => (
              <ul className="flex flex-col">
                {shares.map((entry) => {
                  const isOwner = entry.role === WorkspaceRole.Owner

                  return (
                    <li
                      key={entry.id}
                      className="flex items-center gap-3 border-b border-border-subtle py-2.5 last:border-b-0"
                    >
                      <Avatar
                        size="md"
                        name={entry.user.name}
                        userId={entry.user.id}
                        src={entry.user.avatarUrl}
                      />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body text-foreground">{entry.user.name}</p>
                        <p className="truncate text-caption text-foreground-muted">
                          {entry.user.email}
                        </p>
                      </div>

                      {isOwner ? (
                        <span className="shrink-0 text-caption text-foreground-muted">Owner</span>
                      ) : (
                        <Select
                          label={`Role for ${entry.user.name}`}
                          hideLabel
                          options={[...ROLE_OPTIONS, { value: 'remove', label: 'Remove access' }]}
                          value={entry.role}
                          disabled={updateRole.isPending}
                          onChange={(event) => {
                            const next = event.target.value
                            if (next === 'remove') {
                              toast.show({
                                title: "Removing access isn’t built yet",
                                description: `${entry.user.name} would lose access.`,
                              })
                              return
                            }
                            updateRole.mutate({ shareId: entry.id, role: next as WorkspaceRole })
                          }}
                          containerClassName="w-36 shrink-0"
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </QueryState>
        </section>

        <Alert variant="info">
          {ROLE_HINT.editor}. {ROLE_HINT.viewer}. Access is enforced by the server — what this
          dialog hides is convenience, not security.
        </Alert>
      </div>
    </Dialog>
  )
}
