import { zodResolver } from '@hookform/resolvers/zod'
import { UserPlus } from 'lucide-react'
import { useForm } from 'react-hook-form'

import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useInviteMember } from '@/hooks/useMemberMutations'
import { inviteMemberSchema } from '@/schemas/content'
import { isApiError } from '@/types/api'
import { WorkspaceRole } from '@/types/auth'
import { applyFieldErrors } from '@/utils/formErrors'

/**
 * Invite by email. (CLAUDE.md §38, §63, §80)
 *
 * Owner is deliberately absent from the invite roles. Handing full
 * administrative control to an address that has not yet been confirmed is a
 * door worth keeping shut; an owner can promote them from the roster once they
 * have accepted.
 */

const INVITE_ROLES = [
  { value: WorkspaceRole.Editor, label: 'Editor' },
  { value: WorkspaceRole.Viewer, label: 'Viewer' },
]

export function InviteMemberForm({ workspaceId }: { workspaceId: string }) {
  const invite = useInviteMember(workspaceId)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(inviteMemberSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { email: '', role: WorkspaceRole.Editor },
  })

  const onSubmit = handleSubmit(async (values) => {
    try {
      await invite.mutateAsync(values)
      reset()
    } catch (error) {
      /* "Already a member" comes back as a field error on `email`, so it lands
         next to the input the user has to change rather than in a toast that
         disappears while they are still reading it. */
      const handled = applyFieldErrors(error, setError, ['email', 'role'])
      if (!handled) {
        setError('email', {
          message: isApiError(error) ? error.message : "That invitation couldn't be sent.",
        })
      }
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        <Input
          label="Invite by email"
          type="email"
          autoComplete="off"
          placeholder="teammate@company.com"
          error={errors.email?.message}
          containerClassName="min-w-56 flex-1"
          {...register('email')}
        />

        <Select
          label="Role"
          options={INVITE_ROLES}
          error={errors.role?.message}
          containerClassName="w-36"
          {...register('role')}
        />

        {/* Aligned to the control row, not the labels above it. */}
        <Button
          type="submit"
          variant="primary"
          loading={isSubmitting}
          loadingLabel="Sending invitation"
          leadingIcon={<UserPlus aria-hidden="true" />}
          className="mt-[1.625rem]"
        >
          Invite
        </Button>
      </div>

      <Alert variant="info">
        Editors can create and change anything in the workspace. Viewers can read and comment.
        Access is enforced by the server — what this screen hides is convenience, not security.
      </Alert>
    </form>
  )
}
