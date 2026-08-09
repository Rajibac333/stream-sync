import { api } from '@/api/client'
import type { ActivityAction, ActivityEvent } from '@/types/activity'
import type { Paginated } from '@/types/api'
import type { DashboardSummary } from '@/types/dashboard'

/** Activity feed and dashboard summary. (CLAUDE.md §31, §44) */

interface ActorDto {
  id: string
  name: string
  avatar_url: string | null
}

interface ActivityDto {
  id: string
  workspace_id: string
  action: ActivityAction
  actor: ActorDto
  target: { type: ActivityEvent['target']['type']; id: string; name: string; href: string | null }
  context: string | null
  created_at: string
}

function toActivity(dto: ActivityDto): ActivityEvent {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    action: dto.action,
    actor: { id: dto.actor.id, name: dto.actor.name, avatarUrl: dto.actor.avatar_url },
    target: dto.target,
    context: dto.context,
    createdAt: dto.created_at,
  }
}

export const activityApi = {
  async list(workspaceId: string): Promise<ActivityEvent[]> {
    const page = await api.get<Paginated<ActivityDto>>('/activity/', {
      params: { workspace: workspaceId },
    })
    return page.results.map(toActivity)
  },
}

interface DashboardDto {
  active_project_count: number
  open_task_count: number
  due_today_count: number
  completed_this_week_count: number
  collaborators: {
    user: ActorDto
    status: 'online' | 'idle' | 'offline'
    activity: string | null
  }[]
}

export const dashboardApi = {
  async summary(workspaceId: string): Promise<DashboardSummary> {
    const dto = await api.get<DashboardDto>('/dashboard/', {
      params: { workspace: workspaceId },
    })

    return {
      activeProjectCount: dto.active_project_count,
      openTaskCount: dto.open_task_count,
      dueTodayCount: dto.due_today_count,
      completedThisWeekCount: dto.completed_this_week_count,
      collaborators: dto.collaborators.map((entry) => ({
        user: { id: entry.user.id, name: entry.user.name, avatarUrl: entry.user.avatar_url },
        status: entry.status,
        activity: entry.activity,
      })),
    }
  },
}
