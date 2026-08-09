import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useEffect, useState } from 'react'

import { LabelPicker, LabelPickerSkeleton } from '@/components/tasks/LabelPicker'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { useCurrentUser } from '@/hooks/useAuth'
import { useCreateTask } from '@/hooks/useContentMutations'
import { useLabels, useMembers, useProjects } from '@/hooks/useWorkspaceContent'
import { createTaskSchema } from '@/schemas/content'
import { isApiError } from '@/types/api'
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  TaskPriority,
  TaskStatus,
} from '@/types/task'
import { applyFieldErrors } from '@/utils/formErrors'

/** Create task. (CLAUDE.md §42, §43) */

const STATUS_OPTIONS = TASK_STATUS_ORDER.map((status) => ({
  value: status,
  label: TASK_STATUS_LABELS[status],
}))

const PRIORITY_OPTIONS = [
  TaskPriority.Urgent,
  TaskPriority.High,
  TaskPriority.Medium,
  TaskPriority.Low,
].map((priority) => ({ value: priority, label: TASK_PRIORITY_LABELS[priority] }))

export interface TaskFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  /** Pre-selects a project — used from a project's own Tasks tab. */
  defaultProjectId?: string
  /** Pre-selects a column — used by the "+" at the head of a Kanban column. */
  defaultStatus?: TaskStatus
}

export function TaskFormDialog({
  open,
  onOpenChange,
  workspaceId,
  defaultProjectId,
  defaultStatus = TaskStatus.Todo,
}: TaskFormDialogProps) {
  const user = useCurrentUser()
  const createTask = useCreateTask(workspaceId)
  const { data: projects } = useProjects(workspaceId)
  const { data: members } = useMembers(workspaceId)
  const { data: labels, isPending: labelsPending } = useLabels(workspaceId)
  const [formError, setFormError] = useState<string | null>(null)

  /* Labels sit outside react-hook-form. They have no validation rules — any
     subset of the workspace catalogue is valid — and wiring an array of
     checkboxes through RHF buys nothing but indirection. */
  const [labelIds, setLabelIds] = useState<string[]>([])

  const defaults = {
    title: '',
    description: '',
    projectId: defaultProjectId ?? '',
    status: defaultStatus,
    priority: TaskPriority.Medium,
    assigneeId: '',
    dueDate: '',
  }

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createTaskSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: defaults,
  })

  // Reopening from a different column has to reset to *that* column, so the
  // defaults are reapplied on every close rather than only on first mount.
  useEffect(() => {
    if (!open) {
      reset(defaults)
      setLabelIds([])
      setFormError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset, defaultProjectId, defaultStatus])

  const projectOptions = (projects ?? []).map((project) => ({
    value: project.id,
    label: project.name,
  }))

  // A real option rather than a `placeholder`, which renders as disabled — see
  // TaskDetailDialog for the bug that caused.
  const assigneeOptions = [
    { value: '', label: 'Unassigned' },
    ...(members ?? []).map((member) => ({ value: member.user.id, label: member.user.name })),
  ]

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)

    try {
      await createTask.mutateAsync({
        workspaceId,
        projectId: values.projectId,
        title: values.title,
        description: values.description,
        status: values.status,
        priority: values.priority,
        assigneeId: values.assigneeId,
        dueDate: values.dueDate,
        labelIds,
        actorId: user.id,
      })
      onOpenChange(false)
    } catch (error) {
      const handled = applyFieldErrors(error, setError, [
        'title',
        'description',
        'projectId',
        'status',
        'priority',
        'assigneeId',
        'dueDate',
      ])
      if (!handled) {
        setFormError(
          isApiError(error) ? error.message : "We couldn't create that task. Please try again.",
        )
      }
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New task"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="task-form"
            variant="primary"
            loading={isSubmitting}
            loadingLabel="Creating task"
          >
            Create task
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4 pb-2">
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <Input
          label="Title"
          placeholder="Implement Stripe payment intent flow"
          autoFocus
          required
          error={errors.title?.message}
          {...register('title')}
        />

        <Textarea
          label="Description"
          placeholder="Anything the assignee needs to know."
          rows={3}
          hint="Optional"
          error={errors.description?.message}
          {...register('description')}
        />

        <Select
          label="Project"
          options={projectOptions}
          placeholder="Select a project…"
          required
          error={errors.projectId?.message}
          {...register('projectId')}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            error={errors.status?.message}
            {...register('status')}
          />
          <Select
            label="Priority"
            options={PRIORITY_OPTIONS}
            error={errors.priority?.message}
            {...register('priority')}
          />
          <Select
            label="Assignee"
            options={assigneeOptions}
            error={errors.assigneeId?.message}
            {...register('assigneeId')}
          />
          <Input
            label="Due date"
            type="date"
            hint="Optional"
            error={errors.dueDate?.message}
            {...register('dueDate')}
          />
        </div>

        {labelsPending ? (
          <LabelPickerSkeleton />
        ) : (
          <LabelPicker labels={labels ?? []} value={labelIds} onChange={setLabelIds} />
        )}
      </form>
    </Dialog>
  )
}
