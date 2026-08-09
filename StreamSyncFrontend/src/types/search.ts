/**
 * Global search contracts. (CLAUDE.md §30, §46)
 *
 * Search returns a *flat, uniform* shape rather than one array per entity kind.
 * The command menu ranks results across types — a document called "Billing" can
 * legitimately outrank a project called "Billing v2" — which is impossible if
 * the transport pre-buckets them.
 */

export const SearchResultType = {
  Project: 'project',
  Document: 'document',
  Task: 'task',
  Person: 'person',
} as const

export type SearchResultType = (typeof SearchResultType)[keyof typeof SearchResultType]

export interface SearchResult {
  id: string
  type: SearchResultType
  title: string
  /** Secondary line — project name, assignee, email. */
  subtitle: string | null
  /** Where selecting the result navigates. Null for people until §7 members. */
  href: string | null
  /** Server-side relevance. Higher wins; the client never re-sorts by title. */
  score: number
}

/** Plural labels for result group headings. */
export const SEARCH_TYPE_LABELS: Record<SearchResultType, string> = {
  project: 'Projects',
  document: 'Documents',
  task: 'Tasks',
  person: 'People',
}
