import type { User } from '@/types/auth'

/** Document contracts. (CLAUDE.md §33) */

export type DocumentCollaborator = Pick<User, 'id' | 'name' | 'avatarUrl'>

/**
 * List-view shape. The document *body* is deliberately absent: a documents list
 * that ships every document's content would transfer megabytes to render
 * titles. The full record arrives from the detail endpoint in Milestone 5.
 */
export interface DocumentSummary {
  id: string
  workspaceId: string
  projectId: string | null
  projectName: string | null
  title: string
  /** First line of the body, for the list preview. */
  excerpt: string | null
  author: DocumentCollaborator
  lastEditedBy: DocumentCollaborator
  collaborators: readonly DocumentCollaborator[]
  /** Currently in the document over the WebSocket. Milestone 6 feeds this. */
  activeCollaboratorIds: readonly string[]
  updatedAt: string
  createdAt: string
}

/* -----------------------------------------------------------------------------
 * Detail — the editor's contract. (CLAUDE.md §34)
 * -------------------------------------------------------------------------- */

/**
 * A document with its body.
 *
 * `content` is an HTML string rather than Tiptap's JSON. Both round-trip, and
 * HTML was chosen because it stays readable in the database, survives being
 * rendered by something that is not Tiptap (an email digest, a PDF export, a
 * search indexer), and does not tie the stored format to one editor library's
 * internal schema version.
 */
export interface DocumentDetail extends DocumentSummary {
  content: string
  /** Server's revision counter. Sent with edits so stale writes are detectable. */
  revision: number
}

/* -----------------------------------------------------------------------------
 * Version history (§41)
 * -------------------------------------------------------------------------- */

export interface DocumentVersion {
  id: string
  /** Human-facing number — "Version 12" — not the id. */
  number: number
  author: DocumentCollaborator
  /** One line describing what changed, e.g. "Added Apple Pay section". */
  summary: string
  createdAt: string
  /** True for the version currently open in the editor. */
  isCurrent: boolean
}

/* Comments moved to types/comment.ts when tasks needed them too. (§39)
   Re-exported so existing imports keep working. */
export type { Comment as DocumentComment, CommentReply as DocumentCommentReply } from '@/types/comment'

/* -----------------------------------------------------------------------------
 * Sharing (§38)
 * -------------------------------------------------------------------------- */

export interface DocumentShareEntry {
  id: string
  user: DocumentCollaborator & { email: string }
  role: import('@/types/auth').WorkspaceRole
}
