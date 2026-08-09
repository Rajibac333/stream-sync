import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useEffect, useState } from 'react'

import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { useCurrentUser } from '@/hooks/useAuth'
import { useCreateProject } from '@/hooks/useContentMutations'
import { createProjectSchema } from '@/schemas/content'
import { PROJECT_STATUS_LABELS, ProjectStatus } from '@/types/project'
import { isApiError } from '@/types/api'
import { applyFieldErrors } from '@/utils/formErrors'

/**
 * Create project. (CLAUDE.md §32, §63)
 *
 * The Dialog primitive already supplies focus trapping, Escape-to-close and the
 * accessible title, so this file is only the form.
 */

const STATUS_OPTIONS = [
  ProjectStatus.Planning,
  ProjectStatus.Active,
  ProjectStatus.OnHold,
  ProjectStatus.Completed,
].map((status) => ({ value: status, label: PROJECT_STATUS_LABELS[status] }))

export interface ProjectFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
}

export function ProjectFormDialog({ open, onOpenChange, workspaceId }: ProjectFormDialogProps) {
  const user = useCurrentUser()
  const createProject = useCreateProject(workspaceId)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createProjectSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { name: '', description: '', status: ProjectStatus.Active, dueDate: '' },
  })

  // A dialog reopened after a cancel must not still hold the abandoned draft.
  useEffect(() => {
    if (!open) {
      reset()
      setFormError(null)
    }
  }, [open, reset])

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)

    try {
      await createProject.mutateAsync({
        workspaceId,
        name: values.name,
        description: values.description,
        status: values.status,
        dueDate: values.dueDate,
        actorId: user.id,
      })
      onOpenChange(false)
    } catch (error) {
      const handled = applyFieldErrors(error, setError, ['name', 'description', 'status', 'dueDate'])
      if (!handled) {
        setFormError(
          isApiError(error) ? error.message : "We couldn't create that project. Please try again.",
        )
      }
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New project"
      description="Projects group documents and tasks, and track progress against them."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          {/* Outside the <form>, so it is wired back to it by id. */}
          <Button
            type="submit"
            form="project-form"
            variant="primary"
            loading={isSubmitting}
            loadingLabel="Creating project"
          >
            Create project
          </Button>
        </>
      }
    >
      <form id="project-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4 pb-2">
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <Input
          label="Name"
          placeholder="Checkout Revamp"
          autoFocus
          required
          error={errors.name?.message}
          {...register('name')}
        />

        <Textarea
          label="Description"
          placeholder="What is this project for?"
          rows={3}
          maxLength={280}
          hint="Optional — one or two lines is plenty."
          error={errors.description?.message}
          {...register('description')}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            error={errors.status?.message}
            {...register('status')}
          />

          <Input
            label="Due date"
            type="date"
            hint="Optional"
            error={errors.dueDate?.message}
            {...register('dueDate')}
          />
        </div>
      </form>
    </Dialog>
  )
}
