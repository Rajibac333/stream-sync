import type { User, WorkspaceRole } from '@/types/auth'

/**
 * Workspace contracts.
 *
 * Only what the application shell needs in Milestone 2 — the switcher and the
 * command menu's people search. Project, document and task models arrive with
 * the screens that own them. (Rule 10)
 */

export interface Workspace {
  id: string
  name: string
  slug: string
  description: string | null
  memberCount: number
  /** The signed-in user's role *in this workspace*. Drives UX affordances. */
  role: WorkspaceRole
  createdAt: string
}

/**
 * Whether the person has accepted their invitation.
 *
 * Modelled on the membership rather than as a separate invitation resource: an
 * invited person occupies a seat, counts against the workspace, and is removed
 * the same way an active member is. Two resources would mean two lists, two
 * remove paths, and a UI that has to explain the difference.
 */
export const MemberStatus = {
  Active: 'active',
  Invited: 'invited',
} as const

export type MemberStatus = (typeof MemberStatus)[keyof typeof MemberStatus]

export interface WorkspaceMember {
  id: string
  user: User
  role: WorkspaceRole
  status: MemberStatus
  joinedAt: string
}

/**
 * An invitation waiting for the signed-in user.
 *
 * Names the workspace and the inviter, because that is what the recipient is
 * deciding on. A workspace nobody has joined is deliberately absent from the
 * workspace list, so this is the only place it can be discovered.
 */
export interface PendingInvitation {
  id: string
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  role: WorkspaceRole
  invitedBy: { id: string; name: string; avatarUrl: string | null } | null
  invitedAt: string
}
