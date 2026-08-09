import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { routes } from '@/constants/routes'
import { useCreateWorkspace } from '@/hooks/useContentMutations'
import { createWorkspaceSchema } from '@/schemas/content'
import { isApiError } from '@/types/api'
import { applyFieldErrors } from '@/utils/formErrors'

/**
 * Create workspace. (CLAUDE.md §28)
 *
 * The switcher has offered this since Milestone 2 but had nothing behind it —
 * it raised a toast naming a milestone that had already shipped. This is the
 * real thing.
 *
 * On success it navigates into the new workspace, because a workspace you have
 * just created and are not looking at is a strange place to be left.
 */
export interface WorkspaceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkspaceFormDialog({ open, onOpenChange }: WorkspaceFormDialogProps) {
  const navigate = useNavigate()
  const createWorkspace = useCreateWorkspace()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createWorkspaceSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { name: '', description: '' },
  })

  useEffect(() => {
    if (!open) {
      reset()
      setFormError(null)
    }
  }, [open, reset])

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)

    try {
      const workspace = await createWorkspace.mutateAsync({
        name: values.name,
        description: values.description,
      })
      onOpenChange(false)
      navigate(routes.workspace.projects(workspace.id))
    } catch (error) {
      const handled = applyFieldErrors(error, setError, ['name', 'description'])
      if (!handled) {
        setFormError(
          isApiError(error) ? error.message : "We couldn't create that workspace. Please try again.",
        )
      }
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New workspace"
      description="A workspace holds its own projects, documents, tasks and members."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="workspace-form"
            variant="primary"
            loading={isSubmitting}
            loadingLabel="Creating workspace"
          >
            Create workspace
          </Button>
        </>
      }
    >
      <form id="workspace-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4 pb-2">
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <Input
          label="Name"
          placeholder="EverTech"
          autoFocus
          required
          error={errors.name?.message}
          {...register('name')}
        />

        <Textarea
          label="Description"
          placeholder="What is this workspace for?"
          rows={3}
          maxLength={200}
          hint="Optional"
          error={errors.description?.message}
          {...register('description')}
        />
      </form>
    </Dialog>
  )
}
