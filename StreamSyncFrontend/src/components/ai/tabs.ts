/**
 * AI panel tabs. (CLAUDE.md §47)
 *
 * Declared as data in their own module because the editor page also needs to
 * name a tab — the toolbar's "Ask AI" opens the panel straight onto Rewrite —
 * and a component file exporting non-components is not a Fast Refresh boundary.
 * Same reasoning as components/editor/panels.ts.
 */

export const AiPanelTab = {
  Summary: 'summary',
  Actions: 'actions',
  Rewrite: 'rewrite',
  Ask: 'ask',
} as const

export type AiPanelTab = (typeof AiPanelTab)[keyof typeof AiPanelTab]

export interface AiPanelTabDescriptor {
  value: AiPanelTab
  /**
   * Both the visible text and the accessible name.
   *
   * Deliberately one value rather than a short label with a longer `aria-label`
   * behind it. A control whose accessible name does not contain its visible
   * text cannot be operated by voice — "click Actions" finds nothing when the
   * name is "Action items". (WCAG 2.5.3, CLAUDE.md §19)
   */
  label: string
}

export const AI_PANEL_TABS: readonly AiPanelTabDescriptor[] = [
  { value: AiPanelTab.Summary, label: 'Summary' },
  { value: AiPanelTab.Actions, label: 'Actions' },
  { value: AiPanelTab.Rewrite, label: 'Rewrite' },
  { value: AiPanelTab.Ask, label: 'Ask' },
]
