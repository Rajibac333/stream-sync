import type { Editor } from '@tiptap/react'
import { ListChecks, MessageCircleQuestion, PenLine, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'

import { AIActionItemsView } from '@/components/ai/AIActionItemsView'
import { AIAskView } from '@/components/ai/AIAskView'
import { AIRewriteView } from '@/components/ai/AIRewriteView'
import { AISummaryView } from '@/components/ai/AISummaryView'
import { AiPanelTab, AI_PANEL_TABS } from '@/components/ai/tabs'
import { Tab, TabPanel, Tabs, TabsList } from '@/components/ui/Tabs'
import type { AiDocumentContext } from '@/types/ai'
import type { DocumentDetail } from '@/types/document'

/**
 * The contextual AI assistant. (CLAUDE.md §47)
 *
 * Anchored to the document, not floating beside it. Every action here answers a
 * question about *this* document — summarise it, find the work in it, rewrite a
 * passage of it, ask it something — which is the distinction §47 draws between
 * a contextual assistant and a chat box that happens to be on the page.
 *
 * The panel composes and owns nothing else: each tab is its own component with
 * its own states, and the request layer is the hooks in useAiAssistant.ts. This
 * file's job is the context object, the tab strip, and the footnote.
 */

export interface AIAssistantPanelProps {
  document: DocumentDetail
  workspaceId: string
  editor: Editor | null
  /** Viewers can read every result; only editors can apply or create. (§26) */
  canEdit: boolean
  tab: AiPanelTab
  onTabChange: (tab: AiPanelTab) => void
}

const TAB_ICONS = {
  summary: Sparkles,
  actions: ListChecks,
  rewrite: PenLine,
  ask: MessageCircleQuestion,
} as const

export function AIAssistantPanel({
  document,
  workspaceId,
  editor,
  canEdit,
  tab,
  onTabChange,
}: AIAssistantPanelProps) {
  /* The editor is read through a ref so the context object below can stay
     stable while still resolving fresh content. */
  const editorRef = useRef(editor)
  const fallbackRef = useRef(document.content)

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  useEffect(() => {
    fallbackRef.current = document.content
  }, [document.content])

  /**
   * What every request in this panel is about.
   *
   * `content` is a getter on purpose. The assistant must see the document as it
   * is *now*, including edits that have not been saved — but serialising the
   * document on every render, or re-rendering this panel on every keystroke to
   * keep a string fresh, are both worse than reading it at the moment a request
   * is actually made. The getter does exactly that and nothing else.
   */
  const context = useMemo<AiDocumentContext>(
    () => ({
      documentId: document.id,
      workspaceId,
      title: document.title,
      get content() {
        return editorRef.current?.getHTML() ?? fallbackRef.current
      },
    }),
    [document.id, document.title, workspaceId],
  )

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as AiPanelTab)}
        // Manual: arrowing across the strip with automatic activation would
        // mount three panels — and fire whatever each one does on mount — on
        // the way to the fourth.
        activation="manual"
        className="min-h-0 flex-1"
      >
        <TabsList label="Assistant actions" className="shrink-0 px-3">
          {AI_PANEL_TABS.map(({ value, label }) => {
            const Icon = TAB_ICONS[value]
            return (
              <Tab key={value} value={value} icon={<Icon aria-hidden="true" />}>
                {label}
              </Tab>
            )
          })}
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <TabPanel value={AiPanelTab.Summary} className="pt-4">
            <AISummaryView context={context} />
          </TabPanel>

          <TabPanel value={AiPanelTab.Actions} className="pt-4">
            <AIActionItemsView
              context={context}
              defaultProjectId={document.projectId}
              canCreateTasks={canEdit}
            />
          </TabPanel>

          <TabPanel value={AiPanelTab.Rewrite} className="pt-4">
            <AIRewriteView context={context} editor={editor} canEdit={canEdit} />
          </TabPanel>

          {/* Kept mounted: the conversation lives in the store, but the
              composer draft and the scroll position do not, and losing a
              half-typed question to a stray tab press is infuriating. */}
          <TabPanel value={AiPanelTab.Ask} keepMounted className="flex h-full flex-col pt-4">
            <AIAskView context={context} />
          </TabPanel>
        </div>
      </Tabs>
    </div>
  )
}
