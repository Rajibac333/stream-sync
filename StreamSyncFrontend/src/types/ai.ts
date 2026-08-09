import type { TaskPriority } from '@/types/task'

/**
 * AI assistant contracts. (CLAUDE.md §47–§50)
 *
 * These describe what the *frontend* consumes, not what any provider returns.
 * The browser talks to Django and nothing else:
 *
 *   React → Django → AI service → provider
 *
 * so every type here is the shape of a StreamSync API response. No provider
 * SDK, no provider response shape and — the point of §50 — no key can appear in
 * this package, because everything shipped to the browser is readable by whoever
 * is holding it.
 */

/* -----------------------------------------------------------------------------
 * Provenance
 *
 * Every result says what produced it. While the frontend runs against mocks
 * that is a rule-based analyser in this repository, and the UI says so rather
 * than implying a model wrote it. Passing off deterministic string handling as
 * model output is the one thing that would make every other claim here
 * untrustworthy.
 * -------------------------------------------------------------------------- */

/** Identifier reported by the in-repo mock. Django reports its model instead. */
export const MOCK_ENGINE = 'mock-heuristic'

export interface AiProvenance {
  /** `mock-heuristic`, or the model identifier Django used. */
  engine: string
  generatedAt: string
}

export function isMockEngine(engine: string): boolean {
  return engine === MOCK_ENGINE
}

/* -----------------------------------------------------------------------------
 * Request context
 * -------------------------------------------------------------------------- */

/**
 * What every AI request is *about*.
 *
 * The document id is what a real backend needs; `content` rides along because
 * the assistant answers about what is on screen, including edits that have not
 * been flushed to the server yet. Django is free to prefer its own copy — the
 * id is authoritative, the snapshot is a convenience.
 */
export interface AiDocumentContext {
  documentId: string
  workspaceId: string
  title: string
  /** Live HTML body from the editor. */
  content: string
}

/* -----------------------------------------------------------------------------
 * Summarise (§48)
 * -------------------------------------------------------------------------- */

export interface AiSummary extends AiProvenance {
  summary: string
  keyPoints: readonly string[]
  decisions: readonly string[]
}

/* -----------------------------------------------------------------------------
 * Action items (§49)
 * -------------------------------------------------------------------------- */

/** Whether the owner was named in the document or proposed by the assistant. */
export const AiAssigneeSource = {
  Named: 'named',
  Suggested: 'suggested',
} as const

export type AiAssigneeSource = (typeof AiAssigneeSource)[keyof typeof AiAssigneeSource]

export interface AiActionItem {
  id: string
  title: string
  assigneeId: string | null
  assigneeName: string | null
  /** Drives the "suggested" hint — a proposed owner must not read as a fact. */
  assigneeSource: AiAssigneeSource
  /** ISO date (no time), or null when the document implies no deadline. */
  dueDate: string | null
  priority: TaskPriority
  /**
   * The sentence this was derived from.
   *
   * Shown in the UI so a user can check the item against the document before
   * turning it into somebody's task. An extraction nobody can verify is worse
   * than no extraction.
   */
  sourceQuote: string
  /** Nearest heading the quote sits under, for orientation. */
  sourceSection: string | null
}

export interface AiActionItemsResult extends AiProvenance {
  items: readonly AiActionItem[]
}

/* -----------------------------------------------------------------------------
 * Rewrite (§47)
 * -------------------------------------------------------------------------- */

export const AiRewriteMode = {
  Improve: 'improve',
  Shorten: 'shorten',
  Expand: 'expand',
  Tone: 'tone',
} as const

export type AiRewriteMode = (typeof AiRewriteMode)[keyof typeof AiRewriteMode]

export const AI_REWRITE_LABELS: Record<AiRewriteMode, string> = {
  improve: 'Improve clarity',
  shorten: 'Shorten',
  expand: 'Expand',
  tone: 'Change tone',
}

export const AiTone = {
  Professional: 'professional',
  Friendly: 'friendly',
  Direct: 'direct',
} as const

export type AiTone = (typeof AiTone)[keyof typeof AiTone]

export const AI_TONE_LABELS: Record<AiTone, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  direct: 'Direct',
}

export interface AiRewriteRequest {
  context: AiDocumentContext
  /** Plain text of the selection — never HTML, so applying it cannot inject markup. */
  text: string
  mode: AiRewriteMode
  /** Required by `tone`, ignored otherwise. */
  tone?: AiTone | null
}

export interface AiRewriteResult extends AiProvenance {
  text: string
  mode: AiRewriteMode
  tone: AiTone | null
  /** What actually changed, e.g. "Removed 4 filler words". */
  note: string
  /** False when the pass found nothing to change — said plainly, not faked. */
  changed: boolean
}

/* -----------------------------------------------------------------------------
 * Ask about the document (§47)
 * -------------------------------------------------------------------------- */

export interface AiCitation {
  quote: string
  /** Heading the quote sits under, or null above the first heading. */
  section: string | null
}

export interface AiAnswer extends AiProvenance {
  answer: string
  citations: readonly AiCitation[]
  /**
   * False when the document does not cover the question.
   *
   * The assistant is scoped to this document; a question it cannot answer from
   * the text gets "this document doesn't cover that", never a guess.
   */
  grounded: boolean
}

export const AiMessageRole = {
  User: 'user',
  Assistant: 'assistant',
} as const

export type AiMessageRole = (typeof AiMessageRole)[keyof typeof AiMessageRole]

/** One turn in the document conversation. */
export interface AiMessage {
  id: string
  role: AiMessageRole
  content: string
  citations: readonly AiCitation[]
  grounded: boolean
  createdAt: string
}
