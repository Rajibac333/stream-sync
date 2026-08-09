import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { routes } from '@/constants/routes'
import { useCurrentUser } from '@/hooks/useAuth'
import { useCreateDocument } from '@/hooks/useContentMutations'
import { useProjects } from '@/hooks/useWorkspaceContent'
import { createDocumentSchema } from '@/schemas/content'
import { isApiError } from '@/types/api'
import { applyFieldErrors } from '@/utils/formErrors'

/**
 * Create document. (CLAUDE.md §33)
 *
 * On success it navigates straight into the editor. Creating a document and
 * then having to find it in a list is a step nobody wants — the intent was
 * always to start writing.
 */

export interface DocumentFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  /** Pre-selects a project — used from a project's own Documents tab. */
  defaultProjectId?: string
}

export function DocumentFormDialog({
  open,
  onOpenChange,
  workspaceId,
  defaultProjectId,
}: DocumentFormDialogProps) {
  const user = useCurrentUser()
  const navigate = useNavigate()
  const createDocument = useCreateDocument(workspaceId)
  const { data: projects } = useProjects(workspaceId)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createDocumentSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { title: '', projectId: defaultProjectId ?? '' },
  })

  useEffect(() => {
    if (!open) {
      reset({ title: '', projectId: defaultProjectId ?? '' })
      setFormError(null)
    }
  }, [open, reset, defaultProjectId])

  /* "No project" is a valid choice, so it is an option rather than a
     `placeholder` — which renders disabled and cannot be selected back. */
  const projectOptions = [
    { value: '', label: 'No project' },
    ...(projects ?? []).map((project) => ({ value: project.id, label: project.name })),
  ]

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)

    try {
      const document = await createDocument.mutateAsync({
        workspaceId,
        title: values.title,
        projectId: values.projectId,
        actorId: user.id,
      })
      onOpenChange(false)
      navigate(routes.workspace.document(workspaceId, document.id))
    } catch (error) {
      const handled = applyFieldErrors(error, setError, ['title', 'projectId'])
      if (!handled) {
        setFormError(
          isApiError(error) ? error.message : "We couldn't create that document. Please try again.",
        )
      }
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New document"
      description="You'll be taken straight into the editor."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="document-form"
            variant="primary"
            loading={isSubmitting}
            loadingLabel="Creating document"
          >
            Create document
          </Button>
        </>
      }
    >
      <form id="document-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4 pb-2">
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <Input
          label="Title"
          placeholder="Payment Requirements"
          autoFocus
          required
          error={errors.title?.message}
          {...register('title')}
        />

        <Select
          label="Project"
          options={projectOptions}
          hint="Optional — documents can live at workspace level."
          error={errors.projectId?.message}
          {...register('projectId')}
        />
      </form>
    </Dialog>
  )
}
