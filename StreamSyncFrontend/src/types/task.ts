import type { User } from '@/types/auth'

/** Task contracts. (CLAUDE.md §42, §43) */

export const TaskStatus = {
  Todo: 'todo',
  InProgress: 'in_progress',
  Review: 'review',
  Done: 'done',
} as const

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus]

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
}

/** Board column order. Declared once so every view agrees. */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  TaskStatus.Todo,
  TaskStatus.InProgress,
  TaskStatus.Review,
  TaskStatus.Done,
]

export const TaskPriority = {
  Urgent: 'urgent',
  High: 'high',
  Medium: 'medium',
  Low: 'low',
} as const

export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority]

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export interface TaskLabel {
  id: string
  name: string
}

export interface Task {
  id: string
  workspaceId: string
  projectId: string
  /** Denormalised for list rendering — a task row always shows its project. */
  projectName: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assignee: Pick<User, 'id' | 'name' | 'avatarUrl'> | null
  /** ISO date (no time component). Null when undated. */
  dueDate: string | null
  labels: readonly TaskLabel[]
  commentCount: number
  updatedAt: string
  createdAt: string
}
