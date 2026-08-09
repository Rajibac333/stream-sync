import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import { commentsApi } from '@/api/comments'
import { queryKeys } from '@/api/queryKeys'
import { toast } from '@/store/toastStore'
import { isApiError } from '@/types/api'
import type { Comment, CommentMention, CommentResource } from '@/types/comment'

/**
 * Comments. (CLAUDE.md §39, §52)
 *
 * One hook set for both documents and tasks — the resource is a parameter, not
 * a separate implementation.
 *
 * Every write invalidates the notification list as well as the thread, because
 * a mention creates a notification server-side. Without that the badge only
 * updates on the next poll, and a user who mentions someone sees nothing
 * happen — which reads as the mention having failed.
 */

export function useComments(
  resourceType: CommentResource,
  resourceId: string | undefined,
  enabled = true,
): UseQueryResult<Comment[]> {
  return useQuery({
    queryKey: queryKeys.comments.forResource(resourceType, resourceId ?? ''),
    queryFn: () => commentsApi.list(resourceType, resourceId ?? ''),
    enabled: Boolean(resourceId) && enabled,
    staleTime: 20_000,
  })
}

interface MutationContext {
  resourceType: CommentResource
  resourceId: string
}

function useCommentInvalidation({ resourceType, resourceId }: MutationContext) {
  const queryClient = useQueryClient()

  return () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.comments.forResource(resourceType, resourceId),
    })
    // A mention raises a notification; the badge must move with it.
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
    // Commenting is an activity event, and the task's own comment count moves.
    void queryClient.invalidateQueries({ queryKey: queryKeys.activity.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
  }
}

export interface PostCommentVariables {
  body: string
  mentions: readonly CommentMention[]
  quotedText?: string | null
}

export function usePostComment(context: MutationContext) {
  const invalidate = useCommentInvalidation(context)

  return useMutation({
    mutationFn: ({ body, mentions, quotedText = null }: PostCommentVariables) =>
      commentsApi.create({
        resourceType: context.resourceType,
        resourceId: context.resourceId,
        body,
        mentions,
        quotedText,
      }),
    onSuccess: invalidate,
    onError: (error) =>
      toast.error({
        title: "Couldn't post that comment",
        ...(isApiError(error) ? { description: error.message } : {}),
      }),
  })
}

export interface ReplyVariables {
  commentId: string
  body: string
  mentions: readonly CommentMention[]
}

export function useReplyToComment(context: MutationContext) {
  const invalidate = useCommentInvalidation(context)

  return useMutation({
    mutationFn: ({ commentId, body, mentions }: ReplyVariables) =>
      commentsApi.reply({ commentId, body, mentions }),
    onSuccess: invalidate,
    onError: (error) =>
      toast.error({
        title: "Couldn't post that reply",
        ...(isApiError(error) ? { description: error.message } : {}),
      }),
  })
}

/**
 * Resolve and reopen, optimistically.
 *
 * Toggling a thread is a low-stakes, instantly-reversible action, and a
 * round-trip before the checkmark moves makes the button feel unresponsive.
 */
export function useResolveComment(context: MutationContext) {
  const queryClient = useQueryClient()
  const invalidate = useCommentInvalidation(context)
  const key = queryKeys.comments.forResource(context.resourceType, context.resourceId)

  return useMutation({
    mutationFn: ({ commentId, resolved }: { commentId: string; resolved: boolean }) =>
      commentsApi.setResolved(commentId, resolved),

    onMutate: async ({ commentId, resolved }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Comment[]>(key)

      queryClient.setQueryData<Comment[]>(key, (comments) =>
        comments?.map((comment) =>
          comment.id === commentId ? { ...comment, resolved } : comment,
        ),
      )

      return { previous }
    },

    onError: (error, _variables, context_) => {
      if (context_?.previous) queryClient.setQueryData(key, context_.previous)
      toast.error({
        title: "Couldn't update that thread",
        ...(isApiError(error) ? { description: error.message } : {}),
      })
    },

    onSettled: invalidate,
  })
}

export function useDeleteComment(context: MutationContext) {
  const invalidate = useCommentInvalidation(context)

  return useMutation({
    mutationFn: (commentId: string) => commentsApi.remove(commentId),
    onSuccess: () => {
      invalidate()
      toast.success({ title: 'Comment deleted' })
    },
    onError: (error) =>
      toast.error({
        title: "Couldn't delete that comment",
        ...(isApiError(error) ? { description: error.message } : {}),
      }),
  })
}
