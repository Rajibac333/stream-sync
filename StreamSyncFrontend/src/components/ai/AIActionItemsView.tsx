import { ListChecks, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AIActionItemRow } from '@/components/ai/AIActionItemRow'
import { AIThinking } from '@/components/ai/AIThinking'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Select } from '@/components/ui/Select'
import { useAiActionItems, useCreateTasksFromActionItems } from '@/hooks/useAiAssistant'
import { useMembers, useProjects } from '@/hooks/useWorkspaceContent'
import type { AiDocumentContext } from '@/types/ai'

/**
 * Extracted action items, and the path from them to real tasks. (CLAUDE.md §49)
 *
 * The flow is deliberately a review step rather than a one-click conversion:
 * extract, edit, choose what to keep, then create. Turning a document's
 * sentences straight into assigned work with people's names on it is the kind
 * of automation that is impressive once and resented afterwards.
 *
 * "Found nothing" is a first-class result. A document with no owned work in it
 * gets told so, not padded with items invented to fill the panel.
 */

export interface AIActionItemsViewProps {
  context: AiDocumentContext
  /** The document's own project, pre-selected when it has one. */
  defaultProjectId: string | null
  canCreateTasks: boolean
}

export function AIActionItemsView({
  context,
  defaultProjectId,
  canCreateTasks,
}: AIActionItemsViewProps) {
  const { extraction, extract, isPending, error, update, remove } = useAiActionItems(context)
  const createTasks = useCreateTasksFromActionItems(context)

  const projectsQuery = useProjects(context.workspaceId)
  const membersQuery = useMembers(context.workspaceId)

  const [projectId, setProjectId] = useState(defaultProjectId ?? '')

  /* Tasks belong to a project, and the document may not have one. Falling back
     to the first project the workspace has means the select is never empty
     while still letting the user change it. */
  useEffect(() => {
    if (projectId) return
    const first = projectsQuery.data?.[0]?.id
    if (first) setProjectId(first)
  }, [projectId, projectsQuery.data])

  const people = (membersQuery.data ?? []).map((member) => ({
    id: member.user.id,
    name: member.user.name,
  }))

  if (isPending) {
    return <AIThinking label="Reading for owners and deadlines" lines={5} />
  }

  if (error) {
    return (
      <ErrorState
        size="inline"
        title="Couldn't extract action items"
        description={error}
        onRetry={extract}
      />
    )
  }

  if (extraction === null) {
    return (
      <EmptyState
        size="inline"
        icon={<ListChecks />}
        title="Find the work in this document"
        description="Pulls out anything that reads as a task, with an owner, a deadline and the sentence it came from."
        action={
          <Button
            variant="primary"
            onClick={extract}
            leadingIcon={<ListChecks aria-hidden="true" />}
          >
            Extract action items
          </Button>
        }
      />
    )
  }

  const { items } = extraction

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          size="inline"
          icon={<ListChecks />}
          title="No action items found"
          description="Nothing here reads as work with an owner. Assignments like “Maria will design the checkout screen”, open questions and scope bullets are what this looks for."
          action={
            <Button
              variant="secondary"
              onClick={extract}
              leadingIcon={<RefreshCw aria-hidden="true" />}
            >
              Look again
            </Button>
          }
        />
      </div>
    )
  }

  const selected = items.filter((item) => item.selected)
  const busy = createTasks.isPending

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <AIActionItemRow
            key={item.id}
            item={item}
            people={people}
            disabled={busy}
            onChange={(patch) => update(item.id, patch)}
            onRemove={() => remove(item.id)}
          />
        ))}
      </ul>

      <div className="flex flex-col gap-3 border-t border-border pt-3">
        {canCreateTasks ? (
          <>
            <Select
              label="Create in project"
              value={projectId}
              disabled={busy}
              placeholder={projectsQuery.data?.length ? undefined : 'No projects yet'}
              options={(projectsQuery.data ?? []).map((project) => ({
                value: project.id,
                label: project.name,
              }))}
              onChange={(event) => setProjectId(event.target.value)}
              hint="Each task links back to the sentence it came from."
            />

            <Button
              variant="primary"
              fullWidth
              loading={busy}
              loadingLabel="Creating tasks"
              disabled={selected.length === 0 || !projectId}
              onClick={() => createTasks.mutate({ projectId, items: selected })}
            >
              {selected.length === 0
                ? 'Select an item to create'
                : `Create ${selected.length} ${selected.length === 1 ? 'task' : 'tasks'}`}
            </Button>
          </>
        ) : (
          <Alert variant="info">
            You have view access to this workspace, so these can’t be turned into tasks. The
            extraction is still yours to read.
          </Alert>
        )}

        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={extract}
          leadingIcon={<RefreshCw aria-hidden="true" />}
          className="self-start"
        >
          Redo
        </Button>
      </div>
    </div>
  )
}
