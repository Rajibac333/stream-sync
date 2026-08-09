import { Check, Reply, Trash2, Undo2 } from 'lucide-react'
import { Fragment, useState } from 'react'

import { CommentComposer } from '@/components/comments/CommentComposer'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { canDeleteComment, type Comment, type CommentMention } from '@/types/comment'
import { formatAbsoluteTime, formatRelativeTime } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * One comment thread. (CLAUDE.md §39)
 *
 * Everything §39 lists: author, avatar, timestamp, content, replies, mentions,
 * resolve, reopen, and delete-own.
 *
 * Deletion is behind a confirmation because it is the only irreversible action
 * here — resolve is a toggle, replies are additive, but a deleted comment takes
 * its replies with it.
 */

/**
 * Renders @mentions as chips.
 *
 * Highlighting is driven by the stored mention list, not by scanning for "@" —
 * so a literal "@" in prose is left alone, and a mention survives the mentioned
 * person renaming themselves.
 */
function CommentBody({ body, mentions }: { body: string; mentions: readonly CommentMention[] }) {
  if (mentions.length === 0) {
    return <span className="whitespace-pre-wrap">{body}</span>
  }

  // Longest first, so "@Maria" is not partially matched by a shorter "@Mar".
  const names = [...new Set(mentions.map((mention) => mention.name))].sort(
    (a, b) => b.length - a.length,
  )
  const pattern = new RegExp(`(@(?:${names.map(escapeRegExp).join('|')}))`, 'g')
  const pieces = body.split(pattern)

  return (
    <span className="whitespace-pre-wrap">
      {pieces.map((piece, index) =>
        piece.startsWith('@') && names.includes(piece.slice(1)) ? (
          <span
            key={index}
            className="rounded-xs bg-primary-subtle px-1 font-medium text-primary-subtle-foreground"
          >
            {piece}
          </span>
        ) : (
          <Fragment key={index}>{piece}</Fragment>
        ),
      )}
    </span>
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface CommentThreadProps {
  comment: Comment
  currentUserId: string
  workspaceId: string | null
  busy?: boolean
  onReply: (commentId: string, body: string, mentions: CommentMention[]) => void
  onToggleResolved: (commentId: string, resolved: boolean) => void
  onDelete: (commentId: string) => void
}

export function CommentThread({
  comment,
  currentUserId,
  workspaceId,
  busy = false,
  onReply,
  onToggleResolved,
  onDelete,
}: CommentThreadProps) {
  const [replying, setReplying] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const mine = canDeleteComment(comment, currentUserId)

  return (
    <li
      className={cn(
        'rounded-lg border border-border bg-surface p-3',
        // Resolved threads recede rather than disappearing — a resolved comment
        // is a record of a decision.
        comment.resolved && 'opacity-70',
      )}
    >
      {comment.quotedText ? (
        <p className="mb-2 border-l-2 border-primary-border pl-2 text-caption italic text-foreground-subtle">
          “{comment.quotedText}”
        </p>
      ) : null}

      <article className="flex items-start gap-2.5">
        <Avatar
          size="sm"
          name={comment.author.name}
          userId={comment.author.id}
          src={comment.author.avatarUrl}
        />

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-small font-medium text-foreground">{comment.author.name}</span>
            <time
              dateTime={comment.createdAt}
              title={formatAbsoluteTime(comment.createdAt)}
              className="text-caption text-foreground-subtle"
            >
              {formatRelativeTime(comment.createdAt)}
            </time>
            {comment.resolved ? (
              <span className="rounded-sm bg-success-subtle px-1.5 py-px text-caption font-medium text-success-subtle-foreground">
                Resolved
              </span>
            ) : null}
          </p>

          <p className="mt-0.5 text-small text-foreground-muted">
            <CommentBody body={comment.body} mentions={comment.mentions} />
          </p>
        </div>
      </article>

      {comment.replies.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-3 border-l border-border pl-3">
          {comment.replies.map((reply) => (
            <li key={reply.id} className="flex items-start gap-2.5">
              <Avatar
                size="xs"
                name={reply.author.name}
                userId={reply.author.id}
                src={reply.author.avatarUrl}
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-caption font-medium text-foreground">
                    {reply.author.name}
                  </span>
                  <time dateTime={reply.createdAt} className="text-caption text-foreground-subtle">
                    {formatRelativeTime(reply.createdAt)}
                  </time>
                </p>
                <p className="mt-0.5 text-caption text-foreground-muted">
                  <CommentBody body={reply.body} mentions={reply.mentions} />
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {replying ? (
        <div className="mt-3">
          <CommentComposer
            workspaceId={workspaceId}
            compact
            autoFocus
            placeholder={`Reply to ${comment.author.name.split(' ')[0]}…`}
            submitLabel="Reply"
            busy={busy}
            onSubmit={(body, mentions) => {
              onReply(comment.id, body, mentions)
              setReplying(false)
            }}
            onCancel={() => setReplying(false)}
          />
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Reply aria-hidden="true" />}
            onClick={() => setReplying(true)}
          >
            Reply
          </Button>

          <Button
            variant="ghost"
            size="sm"
            leadingIcon={
              comment.resolved ? <Undo2 aria-hidden="true" /> : <Check aria-hidden="true" />
            }
            onClick={() => onToggleResolved(comment.id, !comment.resolved)}
          >
            {comment.resolved ? 'Reopen' : 'Resolve'}
          </Button>

          {/* Only the author's own comment offers deletion. The server checks
              too — hiding a control enforces nothing. (§26, §39) */}
          {mine ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger-subtle"
              leadingIcon={<Trash2 aria-hidden="true" />}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          ) : null}
        </div>
      )}

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this comment?"
        description={
          comment.replies.length > 0
            ? `Its ${comment.replies.length} ${comment.replies.length === 1 ? 'reply' : 'replies'} will be deleted too. This cannot be undone.`
            : 'This cannot be undone.'
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                onDelete(comment.id)
                setConfirmDelete(false)
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </li>
  )
}
