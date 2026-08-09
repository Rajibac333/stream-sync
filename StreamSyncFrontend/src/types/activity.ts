import type { User } from '@/types/auth'

/** Activity contracts. (CLAUDE.md §44) */

export const ActivityAction = {
  ProjectCreated: 'project_created',
  DocumentCreated: 'document_created',
  DocumentEdited: 'document_edited',
  TaskCreated: 'task_created',
  TaskCompleted: 'task_completed',
  MemberInvited: 'member_invited',
  CommentAdded: 'comment_added',
  AiAction: 'ai_action',
} as const

export type ActivityAction = (typeof ActivityAction)[keyof typeof ActivityAction]

/**
 * One entry in the timeline.
 *
 * The server sends the verb (`action`) and the subject (`target`) separately
 * rather than a pre-composed sentence, so the client can render "Maria edited
 * **Payment Requirements**" with the target as a real link — and so the copy
 * can be translated later without the backend reissuing history.
 */
export interface ActivityEvent {
  id: string
  workspaceId: string
  action: ActivityAction
  actor: Pick<User, 'id' | 'name' | 'avatarUrl'>
  target: {
    /** Drives the icon and the link. */
    type: 'project' | 'document' | 'task' | 'member' | 'comment'
    id: string
    name: string
    href: string | null
  }
  /** Extra context, e.g. the comment excerpt or the project a task belongs to. */
  context: string | null
  createdAt: string
}

/** Verb phrasing for each action, with the target rendered separately. */
export const ACTIVITY_VERBS: Record<ActivityAction, string> = {
  project_created: 'created the project',
  document_created: 'created',
  document_edited: 'edited',
  task_created: 'created the task',
  task_completed: 'completed',
  member_invited: 'invited',
  comment_added: 'commented on',
  /* Neutral, because the assistant does four different things and the specific
     one goes in `context` — "ran an AI summary on X / Extracted 4 action items"
     contradicted itself. (§44, §47) */
  ai_action: 'used AI on',
}
