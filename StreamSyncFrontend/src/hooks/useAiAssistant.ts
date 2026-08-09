import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useShallow } from 'zustand/react/shallow'

import { aiApi } from '@/api/ai'
import { queryKeys } from '@/api/queryKeys'
import { selectAiSession, useAiStore, type AiActionItemDraft } from '@/store/aiStore'
import { toast } from '@/store/toastStore'
import { isApiError } from '@/types/api'
import {
  AiMessageRole,
  type AiDocumentContext,
  type AiRewriteMode,
  type AiRewriteResult,
  type AiTone,
} from '@/types/ai'

/**
 * AI assistant hooks. (CLAUDE.md §47, §51, §52)
 *
 * The seam between the panel and the service. Components call these; nothing in
 * src/components/ai imports `aiApi` directly, so the day the mock is replaced
 * by Django there is exactly one file to change and no component knows.
 *
 * Two layers of state, split by what they are:
 *
 *   TanStack mutation   the request — pending, error, retry
 *   Zustand session     the result — survives the panel closing (see aiStore)
 *
 * Every operation that writes activity invalidates the feed, because §44 counts
 * AI actions as activity and a timeline that only updates on the next poll
 * reads as the action having done nothing.
 */

/** Both artefact-producing operations write activity; the feed must move. (§44) */
function invalidateActivity(queryClient: QueryClient, workspaceId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.activity.list(workspaceId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.activity.all })
}

function describeError(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback
}

/* -----------------------------------------------------------------------------
 * Summarise (§48)
 * -------------------------------------------------------------------------- */

export function useAiSummary(context: AiDocumentContext) {
  const queryClient = useQueryClient()
  const summary = useAiStore((state) => selectAiSession(state, context.documentId).summary)
  const setSummary = useAiStore((state) => state.setSummary)

  const mutation = useMutation({
    mutationFn: () => aiApi.summarize({ context }),
    onSuccess: (result) => {
      setSummary(context.documentId, result)
      invalidateActivity(queryClient, context.workspaceId)
    },
  })

  return {
    summary,
    generate: () => mutation.mutate(),
    isPending: mutation.isPending,
    error: mutation.isError
      ? describeError(mutation.error, "We couldn't summarise this document.")
      : null,
  }
}

/* -----------------------------------------------------------------------------
 * Action items (§49)
 * -------------------------------------------------------------------------- */

export function useAiActionItems(context: AiDocumentContext) {
  const queryClient = useQueryClient()

  const extraction = useAiStore((state) => selectAiSession(state, context.documentId).actionItems)
  const { setActionItems, updateActionItem, removeActionItem } = useAiStore(
    useShallow((state) => ({
      setActionItems: state.setActionItems,
      updateActionItem: state.updateActionItem,
      removeActionItem: state.removeActionItem,
    })),
  )

  const mutation = useMutation({
    mutationFn: () => aiApi.actionItems({ context }),
    onSuccess: (result) => {
      setActionItems(context.documentId, result)
      invalidateActivity(queryClient, context.workspaceId)
    },
  })

  return {
    /** Null until an extraction has run. */
    extraction,
    extract: () => mutation.mutate(),
    isPending: mutation.isPending,
    error: mutation.isError
      ? describeError(mutation.error, "We couldn't pull action items from this document.")
      : null,
    update: (itemId: string, patch: Partial<AiActionItemDraft>) =>
      updateActionItem(context.documentId, itemId, patch),
    remove: (itemId: string) => removeActionItem(context.documentId, itemId),
  }
}

/**
 * Turns approved items into tasks. (§49)
 *
 * Invalidates the whole workspace rather than just the task list: new tasks
 * move project counters, the dashboard's open-task figure and the activity
 * feed, and a board that updates while the project card behind it does not is
 * the kind of inconsistency people notice immediately.
 */
export function useCreateTasksFromActionItems(context: AiDocumentContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ projectId, items }: { projectId: string; items: readonly AiActionItemDraft[] }) =>
      aiApi.createTasksFromActionItems({
        context,
        projectId,
        items,
      }),

    onSuccess: (tasks) => {
      for (const queryKey of [
        queryKeys.tasks.list(context.workspaceId),
        queryKeys.projects.list(context.workspaceId),
        queryKeys.dashboard.summary(context.workspaceId),
        queryKeys.activity.list(context.workspaceId),
        queryKeys.activity.all,
      ]) {
        void queryClient.invalidateQueries({ queryKey })
      }

      toast.success({
        title: `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} created`,
        description: 'Each one links back to the sentence it came from.',
      })
    },

    onError: (error) =>
      toast.error({
        title: "Couldn't create those tasks",
        description: describeError(error, 'Please try again.'),
      }),
  })
}

/* -----------------------------------------------------------------------------
 * Rewrite (§47)
 *
 * The one operation with no session state. A rewrite is a proposal about a
 * selection that may not exist a moment later, so it lives and dies with the
 * mutation — keeping it would mean offering to apply a suggestion to text the
 * user has already changed.
 * -------------------------------------------------------------------------- */

export interface RewriteVariables {
  text: string
  mode: AiRewriteMode
  tone?: AiTone | null
}

export function useAiRewrite(context: AiDocumentContext) {
  return useMutation<AiRewriteResult, unknown, RewriteVariables>({
    mutationFn: ({ text, mode, tone = null }) => aiApi.rewrite({ context, text, mode, tone }),
    onError: (error) =>
      toast.error({
        title: "Couldn't rewrite that",
        description: describeError(error, 'Please try again.'),
      }),
  })
}

/* -----------------------------------------------------------------------------
 * Ask about the document (§47)
 * -------------------------------------------------------------------------- */

const messageId = () => `msg-${crypto.randomUUID().slice(0, 8)}`

export function useAiConversation(context: AiDocumentContext) {

  const messages = useAiStore((state) => selectAiSession(state, context.documentId).conversation)
  const { appendMessage, clearConversation } = useAiStore(
    useShallow((state) => ({
      appendMessage: state.appendMessage,
      clearConversation: state.clearConversation,
    })),
  )

  const mutation = useMutation({
    mutationFn: (question: string) => aiApi.ask({ context, question }),

    onMutate: (question) => {
      // The user's turn appears immediately — it is their own text, and waiting
      // for the server to echo it back makes the panel feel like it dropped it.
      appendMessage(context.documentId, {
        id: messageId(),
        role: AiMessageRole.User,
        content: question,
        citations: [],
        grounded: true,
        createdAt: new Date().toISOString(),
      })
    },

    onSuccess: (answer) => {
      appendMessage(context.documentId, {
        id: messageId(),
        role: AiMessageRole.Assistant,
        content: answer.answer,
        citations: answer.citations,
        grounded: answer.grounded,
        createdAt: answer.generatedAt,
      })
    },
  })

  return {
    messages,
    ask: (question: string) => mutation.mutate(question),
    isPending: mutation.isPending,
    error: mutation.isError
      ? describeError(mutation.error, "We couldn't answer that just now.")
      : null,
    clear: () => clearConversation(context.documentId),
  }
}
