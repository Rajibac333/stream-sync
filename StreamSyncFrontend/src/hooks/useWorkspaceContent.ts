import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { activityApi, dashboardApi } from '@/api/activity'
import { documentsApi } from '@/api/documents'
import { projectsApi } from '@/api/projects'
import { queryKeys } from '@/api/queryKeys'
import { labelsApi, tasksApi } from '@/api/tasks'
import { workspacesApi } from '@/api/workspaces'
import type { ActivityEvent } from '@/types/activity'
import type { DashboardSummary } from '@/types/dashboard'
import type { DocumentSummary } from '@/types/document'
import { ProjectStatus, type Project } from '@/types/project'
import { TaskStatus, type Task, type TaskLabel } from '@/types/task'
import type { WorkspaceMember } from '@/types/workspace'

/**
 * Workspace content queries. (CLAUDE.md §52)
 *
 * Every one is gated on a workspace id. `enabled: false` while the id is null
 * matters more than it looks: the dashboard renders before the workspace list
 * resolves, and without the gate each section would fire a request for
 * workspace `undefined` and then a real one a moment later — doubling the
 * traffic and flashing an error state in between.
 */

function workspaceQuery<T>(
  key: readonly unknown[],
  fetcher: (workspaceId: string) => Promise<T>,
  workspaceId: string | null,
  staleTime = 60_000,
) {
  return {
    queryKey: key,
    queryFn: () => fetcher(workspaceId ?? ''),
    enabled: workspaceId !== null,
    staleTime,
  }
}

export function useProjects(workspaceId: string | null): UseQueryResult<Project[]> {
  return useQuery(
    workspaceQuery(queryKeys.projects.list(workspaceId ?? ''), projectsApi.list, workspaceId),
  )
}

export function useProject(projectId: string | undefined): UseQueryResult<Project> {
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId ?? ''),
    queryFn: () => projectsApi.get(projectId ?? ''),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  })
}

export function useDocuments(workspaceId: string | null): UseQueryResult<DocumentSummary[]> {
  return useQuery(
    workspaceQuery(queryKeys.documents.list(workspaceId ?? ''), documentsApi.list, workspaceId),
  )
}

export function useTasks(workspaceId: string | null): UseQueryResult<Task[]> {
  return useQuery(
    workspaceQuery(queryKeys.tasks.list(workspaceId ?? ''), tasksApi.list, workspaceId),
  )
}

export function useLabels(workspaceId: string | null): UseQueryResult<TaskLabel[]> {
  return useQuery(
    // The catalogue changes rarely and is read by three surfaces, so it is
    // cached hard rather than refetched alongside the tasks that use it.
    workspaceQuery(queryKeys.labels.list(workspaceId ?? ''), labelsApi.list, workspaceId, 10 * 60_000),
  )
}

export function useActivity(workspaceId: string | null): UseQueryResult<ActivityEvent[]> {
  return useQuery(
    // Shorter staleness: activity is the one surface where being a minute
    // behind is immediately visible as "nothing is happening".
    workspaceQuery(queryKeys.activity.list(workspaceId ?? ''), activityApi.list, workspaceId, 20_000),
  )
}

export function useMembers(workspaceId: string | null): UseQueryResult<WorkspaceMember[]> {
  return useQuery(
    workspaceQuery(
      queryKeys.workspaces.members(workspaceId ?? ''),
      workspacesApi.members,
      workspaceId,
      5 * 60_000,
    ),
  )
}

export function useDashboardSummary(workspaceId: string | null): UseQueryResult<DashboardSummary> {
  return useQuery(
    workspaceQuery(
      queryKeys.dashboard.summary(workspaceId ?? ''),
      dashboardApi.summary,
      workspaceId,
      30_000,
    ),
  )
}

/* -----------------------------------------------------------------------------
 * Derivations
 *
 * Pure functions over an already-fetched list rather than extra queries. They
 * are exported so the dashboard and the workspace page slice the same cached
 * data instead of each fetching its own copy. (§64)
 * -------------------------------------------------------------------------- */

/** Open tasks assigned to a given user, most urgent first. */
const PRIORITY_RANK: Record<Task['priority'], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function selectOpenTasks(tasks: readonly Task[] | undefined): Task[] {
  return (tasks ?? []).filter((task) => task.status !== TaskStatus.Done)
}

export function selectMyTasks(tasks: readonly Task[] | undefined, userId: string): Task[] {
  return selectOpenTasks(tasks)
    .filter((task) => task.assignee?.id === userId)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
}

/** Tasks due on or before today — overdue included, because they are due. */
export function selectDueToday(tasks: readonly Task[] | undefined, today: string): Task[] {
  return selectOpenTasks(tasks)
    .filter((task) => task.dueDate !== null && task.dueDate <= today)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
}

/** Dated, still-open work, soonest first — the "what's coming" rail. */
export function selectUpcomingDeadlines(
  tasks: readonly Task[] | undefined,
  today: string,
  limit = 5,
): Task[] {
  return selectOpenTasks(tasks)
    .filter((task) => task.dueDate !== null && task.dueDate > today)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    .slice(0, limit)
}

export function selectActiveProjects(projects: readonly Project[] | undefined): Project[] {
  return (projects ?? []).filter((project) => project.status === ProjectStatus.Active)
}

/** Groups tasks into board columns, preserving the incoming order per column. */
export function groupTasksByStatus(tasks: readonly Task[] | undefined): Record<TaskStatus, Task[]> {
  const columns: Record<TaskStatus, Task[]> = {
    [TaskStatus.Todo]: [],
    [TaskStatus.InProgress]: [],
    [TaskStatus.Review]: [],
    [TaskStatus.Done]: [],
  }

  for (const task of tasks ?? []) columns[task.status].push(task)
  return columns
}
