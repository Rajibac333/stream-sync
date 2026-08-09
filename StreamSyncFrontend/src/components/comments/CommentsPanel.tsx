import { MessageSquare } from 'lucide-react'
import { useState } from 'react'

import { CommentComposer } from '@/components/comments/CommentComposer'
import { CommentThread } from '@/components/comments/CommentThread'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueryState } from '@/components/ui/QueryState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCurrentUser } from '@/hooks/useAuth'
import {
  useComments,
  useDeleteComment,
  usePostComment,
  useReplyToComment,
  useResolveComment,
} from '@/hooks/useComments'
import type { CommentResource } from '@/types/comment'
import { cn } from '@/utils/cn'

/**
 * Comments panel. (CLAUDE.md §39)
 *
 * One component for documents and tasks alike — the resource is a prop. Used by
 * the editor's side panel and the task detail dialog, which is what stops the
 * two drifting into different feature sets.
 *
 * Resolved threads collapse behind a count rather than being hidden outright: a
 * resolved comment records why a decision was made, and losing that is worse
 * than a slightly longer list.
 */

export interface CommentsPanelProps {
  resourceType: CommentResource
  resourceId: string
  workspaceId: string | null
  /** `panel` fills the editor sidebar; `inline` sits inside a dialog. */
  variant?: 'panel' | 'inline'
  className?: string
}

export function CommentsPanel({
  resourceType,
  resourceId,
  workspaceId,
  variant = 'panel',
  className,
}: CommentsPanelProps) {
  const user = useCurrentUser()
  const commentsQuery = useComments(resourceType, resourceId)
  const context = { resourceType, resourceId }

  const post = usePostComment(context)
  const reply = useReplyToComment(context)
  const resolve = useResolveComment(context)
  const remove = useDeleteComment(context)

  const [showResolved, setShowResolved] = useState(false)
  const busy = post.isPending || reply.isPending

  const composer = (
    <CommentComposer
      workspaceId={workspaceId}
      busy={post.isPending}
      onSubmit={(body, mentions) => post.mutate({ body, mentions })}
    />
  )

  const threads = (
    <QueryState
      query={commentsQuery}
      errorTitle="Couldn't load comments"
      loading={
        <div className="flex flex-col gap-3" aria-busy="true">
          <span className="sr-only" role="status">
            Loading comments
          </span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      }
      empty={
        <EmptyState
          size="inline"
          icon={<MessageSquare />}
          title="No comments yet"
          description="Start the conversation — @mention someone to pull them in."
        />
      }
    >
      {(comments) => {
        const open = comments.filter((comment) => !comment.resolved)
        const resolved = comments.filter((comment) => comment.resolved)

        return (
          <>
            {open.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {open.map((comment) => (
                  <CommentThread
                    key={comment.id}
                    comment={comment}
                    currentUserId={user.id}
                    workspaceId={workspaceId}
                    busy={busy}
                    onReply={(commentId, body, mentions) =>
                      reply.mutate({ commentId, body, mentions })
                    }
                    onToggleResolved={(commentId, next) =>
                      resolve.mutate({ commentId, resolved: next })
                    }
                    onDelete={(commentId) => remove.mutate(commentId)}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                size="inline"
                icon={<MessageSquare />}
                title="Nothing open"
                description={
                  resolved.length > 0
                    ? 'Every thread here has been resolved.'
                    : 'Start the conversation below.'
                }
              />
            )}

            {resolved.length > 0 ? (
              <div className="mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  aria-expanded={showResolved}
                  onClick={() => setShowResolved((current) => !current)}
                >
                  {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
                </Button>

                {showResolved ? (
                  <ul className="mt-3 flex flex-col gap-3">
                    {resolved.map((comment) => (
                      <CommentThread
                        key={comment.id}
                        comment={comment}
                        currentUserId={user.id}
                        workspaceId={workspaceId}
                        busy={busy}
                        onReply={(commentId, body, mentions) =>
                          reply.mutate({ commentId, body, mentions })
                        }
                        onToggleResolved={(commentId, next) =>
                          resolve.mutate({ commentId, resolved: next })
                        }
                        onDelete={(commentId) => remove.mutate(commentId)}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        )
      }}
    </QueryState>
  )

  /* Inside a dialog the whole surface already scrolls; a second scroll
     container would trap the wheel and strand the composer. */
  if (variant === 'inline') {
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        {threads}
        {composer}
      </div>
    )
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{threads}</div>
      <div className="shrink-0 border-t border-border p-3">{composer}</div>
    </div>
  )
}
