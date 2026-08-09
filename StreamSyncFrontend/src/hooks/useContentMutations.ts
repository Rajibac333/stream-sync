import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { documentsApi, type CreateDocumentPayload } from '@/api/documents'
import { projectsApi, type CreateProjectPayload } from '@/api/projects'
import { queryKeys } from '@/api/queryKeys'
import { tasksApi, type CreateTaskPayload, type UpdateTaskPayload } from '@/api/tasks'
import { workspacesApi, type CreateWorkspaceInput } from '@/api/workspaces'

import { toast } from '@/store/toastStore'
import type { Task } from '@/types/task'

/**
 * Writes. (CLAUDE.md §52, §62)
 *
 * Two different strategies, chosen per interaction rather than applied
 * uniformly:
 *
 *   create  invalidate and refetch. The user is watching a dialog close and
 *           expects the new record to appear; a round trip is invisible next to
 *           the dialog animation, and the server owns fields the client cannot
 *           invent (ids, counters, activity entries).
 *
 *   update  optimistic. This backs drag-and-drop, where the card must land
 *           under the cursor *now*. Waiting even 150ms makes the board feel
 *           like it is arguing with the user.
 */

/** Everything a write can invalidate, in one place so nothing is forgotten. */
function invalidateWorkspace(queryClient: QueryClient, workspaceId: string): void {
  const keys = [
    queryKeys.projects.list(workspaceId),
    queryKeys.tasks.list(workspaceId),
    queryKeys.documents.list(workspaceId),
    queryKeys.activity.list(workspaceId),
    queryKeys.dashboard.summary(workspaceId),
  ]
  for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey })
}

/** Restores a document version. (§41) */
export function useRestoreVersion(documentId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ versionId }: { versionId: string; versionNumber: number }) =>
      documentsApi.restoreVersion(documentId, versionId),
    onSuccess: (_document, { versionNumber }) => {
      // The body, the history and the activity feed all move together.
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents.detail(documentId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents.versions(documentId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.activity.all })
      toast.success({
        title: `Restored version ${versionNumber}`,
        description: 'It is now the current version, and the one it replaced is still in history.',
      })
    },
    onError: () => toast.error({ title: "Couldn't restore that version" }),
  })
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateWorkspaceInput) => workspacesApi.create(payload),
    onSuccess: (workspace) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      toast.success({ title: 'Workspace created', description: workspace.name })
    },
  })
}

export function useCreateProject(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateProjectPayload) => projectsApi.create(payload),
    onSuccess: (project) => {
      invalidateWorkspace(queryClient, workspaceId)
      toast.success({ title: 'Project created', description: project.name })
    },
  })
}

export function useCreateDocument(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateDocumentPayload) => documentsApi.create(payload),
    onSuccess: (document) => {
      invalidateWorkspace(queryClient, workspaceId)
      toast.success({ title: 'Document created', description: document.title })
    },
  })
}

export function useCreateTask(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateTaskPayload) => tasksApi.create(payload),
    onSuccess: (task) => {
      invalidateWorkspace(queryClient, workspaceId)
      toast.success({ title: 'Task created', description: task.title })
    },
  })
}

export interface UpdateTaskVariables {
  taskId: string
  patch: UpdateTaskPayload
}

export function useUpdateTask(workspaceId: string) {
  const queryClient = useQueryClient()
  const listKey = queryKeys.tasks.list(workspaceId)

  return useMutation({
    mutationFn: ({ taskId, patch }: UpdateTaskVariables) => tasksApi.update(taskId, patch),

    onMutate: async ({ taskId, patch }) => {
      // Cancel in-flight reads first: one landing mid-mutation would overwrite
      // the optimistic card with the pre-move server state, and the card would
      // visibly snap back to the column it came from.
      await queryClient.cancelQueries({ queryKey: listKey })
      const previous = queryClient.getQueryData<Task[]>(listKey)

      queryClient.setQueryData<Task[]>(listKey, (tasks) =>
        tasks?.map((task) =>
          task.id === taskId
            ? {
                ...task,
                ...(patch.status !== undefined ? { status: patch.status } : {}),
                ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
                ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.description !== undefined ? { description: patch.description } : {}),
                updatedAt: new Date().toISOString(),
              }
            : task,
        ),
      )

      return { previous }
    },

    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous)
      // Silent rollback would look like the drag simply did not register.
      toast.error({
        title: "Couldn't update that task",
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },

    onSettled: () => {
      // Counters, progress and activity all move with a status change, so the
      // whole workspace is revalidated rather than just the task list.
      invalidateWorkspace(queryClient, workspaceId)
    },
  })
}
