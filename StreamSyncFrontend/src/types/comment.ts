import type { User } from '@/types/auth'

/**
 * Comment contracts. (CLAUDE.md §39)
 *
 * Deliberately *not* document-specific. Tasks carry a `commentCount` and the
 * task dialog needs the same thread UI, so a comment is addressed by
 * `(resourceType, resourceId)` rather than by `documentId`. One type, one
 * service, one panel — which is what "all features should use reusable
 * components" means in practice.
 */

export const CommentResource = {
  Document: 'document',
  Task: 'task',
} as const

export type CommentResource = (typeof CommentResource)[keyof typeof CommentResource]

export type CommentAuthor = Pick<User, 'id' | 'name' | 'avatarUrl'>

/**
 * A resolved @mention.
 *
 * Stored as a structured reference alongside the body rather than being parsed
 * out of the text at render time. Parsing display names back out of prose is
 * ambiguous the moment two people share a first name, and it breaks entirely if
 * someone edits their display name after being mentioned.
 */
export interface CommentMention {
  userId: string
  /** The name as it was written, so historical text stays readable. */
  name: string
}

export interface CommentReply {
  id: string
  author: CommentAuthor
  body: string
  mentions: readonly CommentMention[]
  createdAt: string
}

export interface Comment {
  id: string
  resourceType: CommentResource
  resourceId: string
  author: CommentAuthor
  body: string
  mentions: readonly CommentMention[]
  /** Text the thread was anchored to, when it was anchored to a selection. */
  quotedText: string | null
  resolved: boolean
  createdAt: string
  replies: readonly CommentReply[]
}

/**
 * Whether the signed-in user may delete a comment.
 *
 * §39 says "delete own comment", and this is the client-side half of that.
 * It decides what to *render* — the server decides what is permitted, and a
 * hidden button has enforced nothing. (§26)
 */
export function canDeleteComment(comment: Pick<Comment, 'author'>, userId: string): boolean {
  return comment.author.id === userId
}
