/** Notification contracts. (CLAUDE.md §45) */

export const NotificationType = {
  Mention: 'mention',
  TaskAssigned: 'task_assigned',
  DocumentShared: 'document_shared',
  TaskCompleted: 'task_completed',
  ProjectUpdate: 'project_update',
} as const

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType]

export interface NotificationActor {
  id: string
  name: string
  avatarUrl: string | null
}

export interface AppNotification {
  id: string
  type: NotificationType
  /** Already-composed sentence: "Maria mentioned you in Checkout Requirements". */
  title: string
  /** Optional excerpt or supporting line. */
  body: string | null
  /** Absent for system-generated notifications. */
  actor: NotificationActor | null
  /** Destination when the notification is activated. */
  href: string | null
  createdAt: string
  read: boolean
}
