import { create } from 'zustand'

import type { AiActionItem, AiActionItemsResult, AiMessage, AiSummary } from '@/types/ai'

/**
 * AI panel session state. (CLAUDE.md §47, §53)
 *
 * WHY THIS IS ZUSTAND AND NOT TANSTACK QUERY
 *
 * §52 is right that server *resources* belong in the query cache, and none of
 * this is one. A summary is not addressable — there is no GET that returns it,
 * refetching it is a new generation rather than a revalidation, and nothing
 * invalidates it. What it actually is: state belonging to an open panel, which
 * has to survive that panel unmounting when the user closes it and reopens it
 * two minutes later.
 *
 * The request lifecycle — pending, error, retry — stays in TanStack mutations
 * in useAiAssistant.ts. This store holds only what outlives them.
 *
 * Keyed by document, so switching documents never shows the previous one's
 * summary. Memory-only: nothing here is worth restoring into a new session, and
 * persisting a document's contents to localStorage would be a poor default.
 */

/** An extracted item plus the panel state layered on top of it. (§49) */
export interface AiActionItemDraft extends AiActionItem {
  /** Only checked items become tasks. */
  selected: boolean
}

/**
 * The editable working copy of one extraction.
 *
 * Provenance is kept alongside the items rather than dropped, because the panel
 * has to be able to say what produced them and when — a list of tasks with
 * somebody's name attached and no stated origin is exactly the artefact that
 * should not exist.
 */
export interface AiActionItemsDraft {
  items: AiActionItemDraft[]
  engine: string
  generatedAt: string
}

interface AiDocumentSession {
  summary: AiSummary | null
  /** Null before extraction; `items: []` means "ran, found nothing". */
  actionItems: AiActionItemsDraft | null
  conversation: AiMessage[]
}

const EMPTY_SESSION: AiDocumentSession = {
  summary: null,
  actionItems: null,
  conversation: [],
}

interface AiState {
  sessions: Record<string, AiDocumentSession>

  setSummary: (documentId: string, summary: AiSummary) => void
  setActionItems: (documentId: string, result: AiActionItemsResult) => void
  updateActionItem: (documentId: string, itemId: string, patch: Partial<AiActionItemDraft>) => void
  removeActionItem: (documentId: string, itemId: string) => void
  appendMessage: (documentId: string, message: AiMessage) => void
  clearConversation: (documentId: string) => void
  /** Drops everything for one document — used by "Start over". */
  resetDocument: (documentId: string) => void
}

/** Reads a session, or the shared empty one. Never mutates. */
export function selectAiSession(state: AiState, documentId: string): AiDocumentSession {
  return state.sessions[documentId] ?? EMPTY_SESSION
}

export const useAiStore = create<AiState>()((set) => {
  /** Applies a change to one document's session, creating it if absent. */
  const patchSession = (
    documentId: string,
    update: (session: AiDocumentSession) => AiDocumentSession,
  ) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [documentId]: update(state.sessions[documentId] ?? EMPTY_SESSION),
      },
    }))

  return {
    sessions: {},

    setSummary: (documentId, summary) =>
      patchSession(documentId, (session) => ({ ...session, summary })),

    setActionItems: (documentId, result) =>
      patchSession(documentId, (session) => ({
        ...session,
        actionItems: {
          // Everything starts checked: the user reviews and unchecks, rather
          // than hunting for the checkbox that makes the button do anything.
          items: result.items.map((item) => ({ ...item, selected: true })),
          engine: result.engine,
          generatedAt: result.generatedAt,
        },
      })),

    updateActionItem: (documentId, itemId, patch) =>
      patchSession(documentId, (session) => ({
        ...session,
        actionItems: session.actionItems
          ? {
              ...session.actionItems,
              items: session.actionItems.items.map((item) =>
                item.id === itemId ? { ...item, ...patch } : item,
              ),
            }
          : null,
      })),

    removeActionItem: (documentId, itemId) =>
      patchSession(documentId, (session) => ({
        ...session,
        actionItems: session.actionItems
          ? {
              ...session.actionItems,
              items: session.actionItems.items.filter((item) => item.id !== itemId),
            }
          : null,
      })),

    appendMessage: (documentId, message) =>
      patchSession(documentId, (session) => ({
        ...session,
        conversation: [...session.conversation, message],
      })),

    clearConversation: (documentId) =>
      patchSession(documentId, (session) => ({ ...session, conversation: [] })),

    resetDocument: (documentId) =>
      set((state) => {
        const { [documentId]: _removed, ...rest } = state.sessions
        return { sessions: rest }
      }),
  }
})
