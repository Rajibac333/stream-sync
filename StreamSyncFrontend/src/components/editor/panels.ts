/**
 * Editor side panels. (CLAUDE.md §34, §39, §40, §41, §47)
 *
 * Declared as data in their own module because three components need the same
 * list — the header's toggle strip, the More menu, and the sidebar itself —
 * and a component file exporting non-components is not a Fast Refresh
 * boundary.
 */

export const EditorPanel = {
  Outline: 'outline',
  Comments: 'comments',
  History: 'history',
  Ai: 'ai',
} as const

export type EditorPanel = (typeof EditorPanel)[keyof typeof EditorPanel]

export const PANEL_LABELS: Record<EditorPanel, string> = {
  outline: 'Outline',
  comments: 'Comments',
  history: 'Version history',
  ai: 'AI assistant',
}
