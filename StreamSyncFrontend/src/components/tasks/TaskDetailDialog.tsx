import { Link } from 'react-router-dom'

import type { UpdateTaskPayload } from '@/api/tasks'
import { CommentsPanel } from '@/components/comments/CommentsPanel'
import { LabelPicker, LabelPickerSkeleton } from '@/components/tasks/LabelPicker'
import { Avatar } from '@/components/ui/Avatar'
import { Dialog } from '@/components/ui/Dialog'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { routes } from '@/constants/routes'
import { useUpdateTask } from '@/hooks/useContentMutations'
import { useLabels, useMembers } from '@/hooks/useWorkspaceContent'
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  TaskPriority,
  type Task,
  type TaskStatus,
} from '@/types/task'
import { CommentResource } from '@/types/comment'
import { formatAbsoluteTime, formatDueDate, formatRelativeTime } from '@/utils/format'

/**
 * Task detail. (CLAUDE.md §43)
 *
 * Edits save on change rather than behind a Save button. Every field here is a
 * single value with an obvious correct state — a status, an assignee, a date —
 * so there is nothing to "commit", and a dialog that can be dismissed with
 * unsaved changes is a trap. Each change is optimistic and rolls back with a
 * toast if the server refuses. (§62)
 *
 * Comments use the same panel as the document editor, so the two surfaces
 * cannot drift into different feature sets. (§39)
 */

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

export interface TaskDetailDialogProps {
  task: Task | null
  onOpenChange: (open: boolean) => void
  workspaceId: string
}

export function TaskDetailDialog({ task, onOpenChange, workspaceId }: TaskDetailDialogProps) {
  const updateTask = useUpdateTask(workspaceId)
  const { data: members } = useMembers(workspaceId)
  const { data: labels, isPending: labelsPending } = useLabels(workspaceId)

  // Hooks must run unconditionally, so the early return comes after them.
  if (!task) return null

  const patch = (changes: UpdateTaskPayload) => {
    updateTask.mutate({ taskId: task.id, patch: changes })
  }

  const due = task.dueDate ? formatDueDate(task.dueDate) : null

  /* "Unassigned" is a real option, not a placeholder. `placeholder` renders a
     *disabled* <option>, which meant a task could be given an assignee and then
     never have one taken away again. */
  const assigneeOptions = [
    { value: '', label: 'Unassigned' },
    ...(members ?? []).map((member) => ({ value: member.user.id, label: member.user.name })),
  ]

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={task.title}
      size="xl"
      description={`In ${task.projectName}`}
    >
      <div className="flex flex-col gap-5 pb-3">
        {/* -------------------------------------------------------------
            Properties
           ------------------------------------------------------------- */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={task.status}
            onChange={(event) => patch({ status: event.target.value as TaskStatus })}
          />

          <Select
            label="Priority"
            options={PRIORITY_OPTIONS}
            value={task.priority}
            onChange={(event) => patch({ priority: event.target.value as TaskPriority })}
          />

          <Select
            label="Assignee"
            options={assigneeOptions}
            value={task.assignee?.id ?? ''}
            onChange={(event) => patch({ assigneeId: event.target.value || null })}
          />

          <Input
            label="Due date"
            type="date"
            value={task.dueDate ?? ''}
            onChange={(event) => patch({ dueDate: event.target.value || null })}
            {...(due ? { hint: due.label } : {})}
          />
        </div>

        {/* -------------------------------------------------------------
            Description
           ------------------------------------------------------------- */}
        <section>
          <h3 className="mb-1.5 text-small font-medium text-foreground">Description</h3>
          {task.description ? (
            <p className="whitespace-pre-wrap text-body text-foreground-muted">
              {task.description}
            </p>
          ) : (
            <p className="text-body text-foreground-subtle">No description.</p>
          )}
        </section>

        {/* -------------------------------------------------------------
            Metadata
           ------------------------------------------------------------- */}
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-caption text-foreground-muted">
            <span className="flex items-center gap-1.5">
              Project
              <Link
                to={routes.workspace.project(workspaceId, task.projectId)}
                className="rounded-xs font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
              >
                {task.projectName}
              </Link>
            </span>

            {task.assignee ? (
              <span className="flex items-center gap-1.5">
                Assigned to
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Avatar
                    size="xs"
                    name={task.assignee.name}
                    userId={task.assignee.id}
                    src={task.assignee.avatarUrl}
                  />
                  {task.assignee.name}
                </span>
              </span>
            ) : null}

            <span>
              Updated{' '}
              <time dateTime={task.updatedAt} title={formatAbsoluteTime(task.updatedAt)}>
                {formatRelativeTime(task.updatedAt)}
              </time>
            </span>
          </div>

        </section>

        {/* Labels are edited in place like every other property here — the
            selection saves immediately and rolls back on failure. */}
        <section className="border-t border-border pt-4">
          {labelsPending ? (
            <LabelPickerSkeleton />
          ) : (
            <LabelPicker
              labels={labels ?? []}
              value={task.labels.map((label) => label.id)}
              onChange={(labelIds) => patch({ labelIds })}
              disabled={updateTask.isPending}
            />
          )}
        </section>

        {/* -------------------------------------------------------------
            Comments — the same panel the document editor uses. (§39)
           ------------------------------------------------------------- */}
        <section className="border-t border-border pt-4" aria-labelledby="task-comments-heading">
          <h3 id="task-comments-heading" className="mb-2 text-small font-medium text-foreground">
            Comments
          </h3>
          <CommentsPanel
            resourceType={CommentResource.Task}
            resourceId={task.id}
            workspaceId={workspaceId}
            variant="inline"
          />
        </section>
      </div>
    </Dialog>
  )
}
