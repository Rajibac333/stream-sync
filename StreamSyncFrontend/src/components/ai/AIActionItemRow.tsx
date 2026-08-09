import { Pencil, Quote, X } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import type { AiActionItemDraft } from '@/store/aiStore'
import { AiAssigneeSource } from '@/types/ai'
import { TASK_PRIORITY_LABELS, TaskPriority } from '@/types/task'
import { formatDueDate } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * One extracted action item, before it becomes a task. (CLAUDE.md §49)
 *
 * Two things this row is careful about.
 *
 * It is editable *before* creation, because an extraction is a proposal. The
 * title, the owner, the priority and the date are all wrong sometimes, and
 * fixing them afterwards means five people already got a notification about a
 * task that says the wrong thing.
 *
 * And it shows the sentence it came from. An item whose source you cannot check
 * is a claim about a document, and the whole value of extracting rather than
 * generating is that the claim is verifiable in one click.
 */

const PRIORITY_VARIANTS: Record<TaskPriority, 'danger' | 'warning' | 'neutral' | 'outline'> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'neutral',
  low: 'outline',
}

const PRIORITY_OPTIONS = Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export interface AIActionItemRowProps {
  item: AiActionItemDraft
  people: readonly { id: string; name: string }[]
  onChange: (patch: Partial<AiActionItemDraft>) => void
  onRemove: () => void
  disabled?: boolean
}

export function AIActionItemRow({
  item,
  people,
  onChange,
  onRemove,
  disabled = false,
}: AIActionItemRowProps) {
  const [editing, setEditing] = useState(false)

  const due = item.dueDate ? formatDueDate(item.dueDate) : null
  const suggested = item.assigneeSource === AiAssigneeSource.Suggested

  return (
    <li
      className={cn(
        'rounded-lg border border-border bg-surface p-2.5',
        'transition-[border-color,opacity] duration-(--duration-fast)',
        !item.selected && 'opacity-60',
      )}
    >
      <Checkbox
        checked={item.selected}
        disabled={disabled}
        onChange={(event) => onChange({ selected: event.target.checked })}
        label={<span className="text-small leading-snug">{item.title}</span>}
      />

      {/* Metadata, as a summary line. Each value is also a control in edit mode,
          so this row is a display of the same four fields, never a second
          source of truth. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6.5">
        <Badge size="sm" variant={PRIORITY_VARIANTS[item.priority]}>
          {TASK_PRIORITY_LABELS[item.priority]}
        </Badge>

        {item.assigneeName ? (
          <Badge size="sm" variant="neutral">
            {item.assigneeName}
            {/* "Suggested" is load-bearing: the document did not name this
                person, and a proposal must not read as a fact. */}
            {suggested ? <span className="text-foreground-subtle">· suggested</span> : null}
          </Badge>
        ) : (
          <Badge size="sm" variant="outline">
            Unassigned
          </Badge>
        )}

        {due ? (
          <Badge size="sm" variant={due.tone === 'overdue' ? 'danger' : 'neutral'}>
            {due.label}
          </Badge>
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-1 pl-6.5">
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-expanded={editing}
          onClick={() => setEditing((current) => !current)}
          leadingIcon={<Pencil aria-hidden="true" />}
        >
          {editing ? 'Done' : 'Edit'}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onRemove}
          leadingIcon={<X aria-hidden="true" />}
        >
          Remove
        </Button>
      </div>

      {editing ? (
        <div className="mt-2.5 flex flex-col gap-2.5 border-t border-border pt-2.5">
          <Input
            label="Task title"
            value={item.title}
            disabled={disabled}
            onChange={(event) => onChange({ title: event.target.value })}
          />

          <div className="grid grid-cols-2 gap-2">
            <Select
              label="Assignee"
              value={item.assigneeId ?? ''}
              disabled={disabled}
              options={[
                { value: '', label: 'Unassigned' },
                ...people.map((person) => ({ value: person.id, label: person.name })),
              ]}
              onChange={(event) => {
                const assigneeId = event.target.value || null
                onChange({
                  assigneeId,
                  assigneeName:
                    people.find((person) => person.id === assigneeId)?.name ?? null,
                  // Chosen by a human, so it stops being a suggestion.
                  assigneeSource: AiAssigneeSource.Named,
                })
              }}
            />

            <Select
              label="Priority"
              value={item.priority}
              disabled={disabled}
              options={PRIORITY_OPTIONS}
              onChange={(event) => onChange({ priority: event.target.value as TaskPriority })}
            />
          </div>

          <Input
            type="date"
            label="Due date"
            value={item.dueDate ?? ''}
            disabled={disabled}
            onChange={(event) => onChange({ dueDate: event.target.value || null })}
          />
        </div>
      ) : null}

      <details className="group mt-2 pl-6.5">
        <summary
          className={cn(
            'inline-flex cursor-pointer list-none items-center gap-1.5 rounded-xs',
            'text-caption text-foreground-subtle hover:text-foreground-muted',
            'outline-none focus-visible:ring-2 focus-visible:ring-focus',
          )}
        >
          <Quote aria-hidden="true" className="size-3" />
          {item.sourceSection ? `From “${item.sourceSection}”` : 'From this document'}
        </summary>

        <blockquote className="mt-1.5 border-l-2 border-border pl-2 text-caption leading-relaxed text-foreground-muted">
          {item.sourceQuote}
        </blockquote>
      </details>
    </li>
  )
}
