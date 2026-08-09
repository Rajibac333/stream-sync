import { api } from '@/api/client'
import type { Paginated } from '@/types/api'
import type { Task, TaskLabel, TaskPriority, TaskStatus } from '@/types/task'

/** Task service. (CLAUDE.md §42, §51) */

interface AssigneeDto {
  id: string
  name: string
  avatar_url: string | null
}

/**
 * The task wire shape.
 *
 * Exported because `POST /ai/action-items/tasks/` returns the very same
 * objects — confirmed action items come back as ordinary tasks. Two copies of
 * this mapping would be two places to update when a field is added, and one
 * of them would be missed.
 */
export interface TaskDto {
  id: string
  workspace_id: string
  project_id: string
  project_name: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assignee: AssigneeDto | null
  due_date: string | null
  labels: TaskLabel[]
  comment_count: number
  updated_at: string
  created_at: string
}

export function toTask(dto: TaskDto): Task {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    projectId: dto.project_id,
    projectName: dto.project_name,
    title: dto.title,
    description: dto.description,
    status: dto.status,
    priority: dto.priority,
    assignee: dto.assignee
      ? { id: dto.assignee.id, name: dto.assignee.name, avatarUrl: dto.assignee.avatar_url }
      : null,
    dueDate: dto.due_date,
    labels: dto.labels,
    commentCount: dto.comment_count,
    updatedAt: dto.updated_at,
    createdAt: dto.created_at,
  }
}

/** See CreateProjectPayload for why `actorId` never reaches the live API. */
export interface CreateTaskPayload {
  workspaceId: string
  projectId: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assigneeId: string | null
  dueDate: string | null
  /** Ids from the workspace catalogue — never free text. */
  labelIds: readonly string[]
  actorId: string
}

/** Partial by design — the board patches `status` alone on every drop. */
export interface UpdateTaskPayload {
  status?: TaskStatus
  priority?: TaskPriority
  assigneeId?: string | null
  dueDate?: string | null
  title?: string
  description?: string | null
  /** The complete new set, not a delta — omit to leave labels untouched. */
  labelIds?: readonly string[]
}

export const tasksApi = {
  async list(workspaceId: string): Promise<Task[]> {
    const page = await api.get<Paginated<TaskDto>>('/tasks/', {
      params: { workspace: workspaceId },
    })
    return page.results.map(toTask)
  },

  async get(taskId: string): Promise<Task> {
    return toTask(await api.get<TaskDto>(`/tasks/${taskId}/`))
  },

  async create(payload: CreateTaskPayload): Promise<Task> {
    const dto = await api.post<TaskDto>('/tasks/', {
      workspace_id: payload.workspaceId,
      project_id: payload.projectId,
      title: payload.title,
      description: payload.description,
      status: payload.status,
      priority: payload.priority,
      assignee_id: payload.assigneeId,
      due_date: payload.dueDate,
      label_ids: payload.labelIds,
    })
    return toTask(dto)
  },

  async update(taskId: string, patch: UpdateTaskPayload): Promise<Task> {
    // PATCH, not PUT: only the touched fields are sent, so two people editing
    // different fields of the same task do not overwrite each other.
    const dto = await api.patch<TaskDto>(`/tasks/${taskId}/`, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.assigneeId !== undefined ? { assignee_id: patch.assigneeId } : {}),
      ...(patch.dueDate !== undefined ? { due_date: patch.dueDate } : {}),
      ...(patch.labelIds !== undefined ? { label_ids: patch.labelIds } : {}),
    })
    return toTask(dto)
  },
}

/**
 * Workspace label catalogue. (CLAUDE.md §42)
 *
 * Labels belong to the workspace, not to a task, so they are fetched once and
 * shared by the picker, the board filter and the detail panel.
 */
export const labelsApi = {
  async list(_workspaceId: string): Promise<TaskLabel[]> {
    /* There is no label catalogue in the backend: the task serializer returns
       `labels: []` for every task, and no endpoint creates them. Returning an
       empty catalogue is the accurate answer — the picker renders "no labels
       yet" instead of the console filling with 404s for an endpoint that was
       never built. */
    return []
  },
}
