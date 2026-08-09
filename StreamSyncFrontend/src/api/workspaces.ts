import { api } from '@/api/client'
import type { Paginated } from '@/types/api'
import type { User, WorkspaceRole } from '@/types/auth'
import {
  MemberStatus,
  type PendingInvitation,
  type Workspace,
  type WorkspaceMember,
} from '@/types/workspace'

/** Workspace service. Milestone 2 needs listing only — the switcher. (§28) */

interface WorkspaceDto {
  id: string
  name: string
  slug: string
  description: string | null
  member_count: number
  role: WorkspaceRole
  created_at: string
}

function toWorkspace(dto: WorkspaceDto): Workspace {
  return {
    id: dto.id,
    name: dto.name,
    slug: dto.slug,
    description: dto.description,
    memberCount: dto.member_count,
    role: dto.role,
    createdAt: dto.created_at,
  }
}

interface UserDto {
  id: string
  name: string
  email: string
  avatar_url: string | null
  title: string | null
  created_at: string
}

interface WorkspaceMemberDto {
  id: string
  user: UserDto
  role: WorkspaceRole
  status: MemberStatus
  joined_at: string
}

function toUser(dto: UserDto): User {
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    avatarUrl: dto.avatar_url,
    title: dto.title,
    createdAt: dto.created_at,
  }
}

function toMember(dto: WorkspaceMemberDto): WorkspaceMember {
  return {
    id: dto.id,
    user: toUser(dto.user),
    role: dto.role,
    // Older payloads without the field describe a member who is simply in.
    status: dto.status ?? MemberStatus.Active,
    joinedAt: dto.joined_at,
  }
}

interface PendingInvitationDto {
  id: string
  workspace_id: string
  workspace_name: string
  workspace_slug: string
  role: WorkspaceRole
  invited_by: { id: string; name: string; avatar_url: string | null } | null
  invited_at: string
}

function toInvitation(dto: PendingInvitationDto): PendingInvitation {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    workspaceName: dto.workspace_name,
    workspaceSlug: dto.workspace_slug,
    role: dto.role,
    invitedBy: dto.invited_by
      ? {
          id: dto.invited_by.id,
          name: dto.invited_by.name,
          avatarUrl: dto.invited_by.avatar_url,
        }
      : null,
    invitedAt: dto.invited_at,
  }
}

export interface CreateWorkspaceInput {
  name: string
  description: string | null
}

export interface UpdateWorkspacePayload {
  name?: string
  description?: string | null
}

export interface InviteMemberPayload {
  workspaceId: string
  email: string
  role: WorkspaceRole
}

export const workspacesApi = {
  async list(): Promise<Workspace[]> {
    const page = await api.get<Paginated<WorkspaceDto>>('/workspaces/')
    return page.results.map(toWorkspace)
  },

  async get(workspaceId: string): Promise<Workspace> {
    const dto = await api.get<WorkspaceDto>(`/workspaces/${workspaceId}/`)
    return toWorkspace(dto)
  },

  async create(payload: CreateWorkspaceInput): Promise<Workspace> {
    const dto = await api.post<WorkspaceDto>('/workspaces/', {
      name: payload.name,
      description: payload.description,
    })
    return toWorkspace(dto)
  },

  async members(workspaceId: string): Promise<WorkspaceMember[]> {
    const page = await api.get<Paginated<WorkspaceMemberDto>>(
      `/workspaces/${workspaceId}/members/`,
    )
    return page.results.map(toMember)
  },

  /** PATCH /workspaces/:id/ — name and description. (§80) */
  async update(workspaceId: string, patch: UpdateWorkspacePayload): Promise<Workspace> {
    const dto = await api.patch<WorkspaceDto>(`/workspaces/${workspaceId}/`, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
    })
    return toWorkspace(dto)
  },

  /**
   * POST /workspaces/:id/invitations/ (§80)
   *
   * The inviter comes from the session, never the body: a client that can name
   * the actor can name somebody else.
   */
  async invite(payload: InviteMemberPayload): Promise<WorkspaceMember> {
    const dto = await api.post<WorkspaceMemberDto>(
      `/workspaces/${payload.workspaceId}/invitations/`,
      { email: payload.email, role: payload.role },
    )
    return toMember(dto)
  },

  async updateMemberRole(
    workspaceId: string,
    memberId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMember[]> {
    await api.patch<void>(`/workspaces/${workspaceId}/members/${memberId}/`, { role })
    return workspacesApi.members(workspaceId)
  },

  /**
   * GET /workspaces/invitations/
   *
   * The only way an invited person can find the workspace they were invited
   * to: one they have not joined is deliberately excluded from `list()`, so
   * without this the invitation is a notification with nothing behind it.
   */
  async invitations(): Promise<PendingInvitation[]> {
    const page = await api.get<Paginated<PendingInvitationDto>>('/workspaces/invitations/')
    return page.results.map(toInvitation)
  },

  /** POST /workspaces/:id/invitations/accept/ — the invitee's own action. */
  async acceptInvitation(workspaceId: string): Promise<void> {
    await api.post<void>(`/workspaces/${workspaceId}/invitations/accept/`)
  },

  async removeMember(workspaceId: string, memberId: string): Promise<WorkspaceMember[]> {
    await api.delete<void>(`/workspaces/${workspaceId}/members/${memberId}/`)
    return workspacesApi.members(workspaceId)
  },
}
