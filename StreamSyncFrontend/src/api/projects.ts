import { api } from '@/api/client'
import type { Paginated } from '@/types/api'
import type { Project, ProjectStatus } from '@/types/project'

/** Project service. (CLAUDE.md §32, §51) */

interface ProjectMemberDto {
  id: string
  name: string
  avatar_url: string | null
}

interface ProjectDto {
  id: string
  workspace_id: string
  name: string
  description: string | null
  status: ProjectStatus
  task_count: number
  completed_task_count: number
  due_date: string | null
  members: ProjectMemberDto[]
  updated_at: string
  created_at: string
}

function toProject(dto: ProjectDto): Project {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    name: dto.name,
    description: dto.description,
    status: dto.status,
    taskCount: dto.task_count,
    completedTaskCount: dto.completed_task_count,
    dueDate: dto.due_date,
    members: dto.members.map((member) => ({
      id: member.id,
      name: member.name,
      avatarUrl: member.avatar_url,
    })),
    updatedAt: dto.updated_at,
    createdAt: dto.created_at,
  }
}

/**
 * Creation payload.
 *
 * `actorId` exists only for the mock, which has no session to infer the author
 * from. Django takes the user from the authenticated request and would reject a
 * client-supplied one, so it is dropped from the live request body rather than
 * sent and ignored — a client that can name the author is a client that can
 * impersonate one. (CLAUDE.md §26)
 */
export interface CreateProjectPayload {
  workspaceId: string
  name: string
  description: string | null
  status: ProjectStatus
  dueDate: string | null
  actorId: string
}

export const projectsApi = {
  async list(workspaceId: string): Promise<Project[]> {
    const page = await api.get<Paginated<ProjectDto>>('/projects/', {
      params: { workspace: workspaceId },
    })
    return page.results.map(toProject)
  },

  async get(projectId: string): Promise<Project> {
    return toProject(await api.get<ProjectDto>(`/projects/${projectId}/`))
  },

  async create(payload: CreateProjectPayload): Promise<Project> {
    const dto = await api.post<ProjectDto>('/projects/', {
      workspace_id: payload.workspaceId,
      name: payload.name,
      description: payload.description,
      status: payload.status,
      due_date: payload.dueDate,
    })
    return toProject(dto)
  },
}
