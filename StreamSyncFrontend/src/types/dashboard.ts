import type { User } from '@/types/auth'

/**
 * Dashboard summary. (CLAUDE.md §31)
 *
 * One endpoint rather than the dashboard firing eight parallel requests and
 * assembling the answer itself. Counts like "tasks due today" depend on the
 * viewer's whole task set, not on the page of tasks the client happens to hold,
 * so the server is the only place they can be computed correctly.
 */

export interface CollaboratorPresence {
  user: Pick<User, 'id' | 'name' | 'avatarUrl'>
  /** Matches the Avatar component's presence states. (§35) */
  status: 'online' | 'idle' | 'offline'
  /** What they are on right now, e.g. "Editing Payment Requirements". */
  activity: string | null
}

export interface DashboardSummary {
  activeProjectCount: number
  openTaskCount: number
  dueTodayCount: number
  /** Tasks finished by anyone in the workspace this week — momentum, not a KPI. */
  completedThisWeekCount: number
  collaborators: readonly CollaboratorPresence[]
}
