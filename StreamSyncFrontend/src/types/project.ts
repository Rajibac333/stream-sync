import type { User } from '@/types/auth'

/** Project contracts. (CLAUDE.md §32) */

export const ProjectStatus = {
  Planning: 'planning',
  Active: 'active',
  OnHold: 'on_hold',
  Completed: 'completed',
} as const

export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus]

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
}

export interface Project {
  id: string
  workspaceId: string
  name: string
  description: string | null
  status: ProjectStatus
  /**
   * Task counts, sent by the server rather than derived on the client.
   * Progress is a property of the whole project; a client that only holds the
   * first page of tasks would compute it wrong.
   */
  taskCount: number
  completedTaskCount: number
  /** ISO date, or null when the project is open-ended. */
  dueDate: string | null
  members: readonly Pick<User, 'id' | 'name' | 'avatarUrl'>[]
  updatedAt: string
  createdAt: string
}

/** Completion as a 0–100 integer. Returns 0 for an empty project, not NaN. */
export function projectProgress(project: Project): number {
  if (project.taskCount === 0) return 0
  return Math.round((project.completedTaskCount / project.taskCount) * 100)
}
