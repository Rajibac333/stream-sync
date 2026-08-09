import { api } from '@/api/client'
import type { Comment, CommentMention, CommentResource } from '@/types/comment'

/**
 * Comment service. (CLAUDE.md §39, §51)
 *
 * Addressed by `(resourceType, resourceId)` so documents and tasks share one
 * service rather than growing a parallel implementation each.
 *
 * `authorId` and `requesterId` exist for the mock, which has no session to
 * infer identity from. Django takes the user from the authenticated request and
 * would reject a client-supplied one — a client that can name the author is a
 * client that can post as somebody else — so they are dropped from live request
 * bodies rather than sent and ignored. (§26)
 */

/**
 * Inputs.
 *
 * No `authorId` or `requesterId`: identity comes from the session. A client
 * that can name the author is a client that can post as somebody else. (§26)
 */
export interface CreateCommentInput {
  resourceType: CommentResource
  resourceId: string
  body: string
  mentions: readonly CommentMention[]
  quotedText: string | null
}

export interface ReplyInput {
  commentId: string
  body: string
  mentions: readonly CommentMention[]
}

interface CommentDto {
  id: string
  resource_type: CommentResource
  resource_id: string
  author: { id: string; name: string; avatar_url: string | null }
  body: string
  mentions: { user_id: string; name: string }[]
  quoted_text: string | null
  resolved: boolean
  created_at: string
  replies: {
    id: string
    author: { id: string; name: string; avatar_url: string | null }
    body: string
    mentions: { user_id: string; name: string }[]
    created_at: string
  }[]
}

function toComment(dto: CommentDto): Comment {
  return {
    id: dto.id,
    resourceType: dto.resource_type,
    resourceId: dto.resource_id,
    author: { id: dto.author.id, name: dto.author.name, avatarUrl: dto.author.avatar_url },
    body: dto.body,
    mentions: dto.mentions.map((mention) => ({ userId: mention.user_id, name: mention.name })),
    quotedText: dto.quoted_text,
    resolved: dto.resolved,
    createdAt: dto.created_at,
    replies: dto.replies.map((reply) => ({
      id: reply.id,
      author: { id: reply.author.id, name: reply.author.name, avatarUrl: reply.author.avatar_url },
      body: reply.body,
      mentions: reply.mentions.map((mention) => ({ userId: mention.user_id, name: mention.name })),
      createdAt: reply.created_at,
    })),
  }
}

export const commentsApi = {
  async list(resourceType: CommentResource, resourceId: string): Promise<Comment[]> {
    const results = await api.get<CommentDto[]>('/comments/', {
      params: { resource_type: resourceType, resource_id: resourceId },
    })
    return results.map(toComment)
  },

  async create(input: CreateCommentInput): Promise<Comment> {
    const dto = await api.post<CommentDto>('/comments/', {
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      body: input.body,
      mention_ids: input.mentions.map((mention) => mention.userId),
      quoted_text: input.quotedText,
    })
    return toComment(dto)
  },

  async reply(input: ReplyInput): Promise<Comment> {
    const dto = await api.post<CommentDto>(`/comments/${input.commentId}/replies/`, {
      body: input.body,
      mention_ids: input.mentions.map((mention) => mention.userId),
    })
    return toComment(dto)
  },

  async setResolved(commentId: string, resolved: boolean): Promise<Comment> {
    const dto = await api.patch<CommentDto>(`/comments/${commentId}/`, { resolved })
    return toComment(dto)
  },

  async remove(commentId: string): Promise<void> {
    await api.delete(`/comments/${commentId}/`)
  },
}
