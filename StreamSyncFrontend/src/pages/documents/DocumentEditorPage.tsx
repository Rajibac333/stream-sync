import type { Editor } from '@tiptap/react'
import { X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { AIAssistantPanel } from '@/components/ai/AIAssistantPanel'
import { AiPanelTab } from '@/components/ai/tabs'
import { CommentsPanel } from '@/components/comments/CommentsPanel'
import { DocumentEditor } from '@/components/editor/DocumentEditor'
import { DocumentHeader } from '@/components/editor/DocumentHeader'
import { DocumentOutline } from '@/components/editor/DocumentOutline'
import { EditorToolbar } from '@/components/editor/EditorToolbar'
import { LinkDialog } from '@/components/editor/LinkDialog'
import { PANEL_LABELS, type EditorPanel } from '@/components/editor/panels'
import { ShareDialog } from '@/components/editor/ShareDialog'
import { VersionHistoryPanel } from '@/components/editor/VersionHistoryPanel'
import { Button } from '@/components/ui/Button'
import { buttonVariants } from '@/components/ui/Button.variants'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { routes } from '@/constants/routes'
import { useCurrentUser } from '@/hooks/useAuth'
import { useDocumentDetail, useDocumentSession } from '@/hooks/useDocumentSession'
import { usePageBreadcrumbs } from '@/hooks/usePageBreadcrumbs'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { WorkspaceRole } from '@/types/auth'
import { CommentResource } from '@/types/comment'
import { hasCommandModifier } from '@/utils/platform'
import { cn } from '@/utils/cn'

/**
 * Collaborative document editor. (CLAUDE.md §34)
 *
 * Composition only. The editing surface is Tiptap, the real-time layer is
 * `useDocumentSession`, the panels are their own components — this file's job
 * is to wire them together and own the two pieces of state that genuinely
 * belong to the page: which panel is open, and which dialog.
 *
 * That split is what §22 asks for and what keeps this file readable at a
 * fraction of the "DocumentPage.tsx, 2000 lines" it warns against.
 */

export function DocumentEditorPage() {
  const { documentId } = useParams<{ documentId?: string }>()
  const user = useCurrentUser()
  const { workspace } = useActiveWorkspace()

  const documentQuery = useDocumentDetail(documentId)
  const document = documentQuery.data

  const { state, pushContent, pushCursor, remoteContent, acknowledgeRemote } = useDocumentSession(
    documentId,
    document,
  )

  const [editor, setEditor] = useState<Editor | null>(null)
  const [panel, setPanel] = useState<EditorPanel | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  /* Which AI tab is showing. Owned here rather than by the panel because the
     toolbar's "Ask AI" has to be able to open the panel *onto* Rewrite. (§47) */
  const [aiTab, setAiTab] = useState<AiPanelTab>(AiPanelTab.Summary)

  /* A Viewer gets a read-only surface. UX only — §26 is explicit that the
     server is what actually enforces this, and a client that disables an input
     has prevented nothing. */
  const canEdit = workspace ? workspace.role !== WorkspaceRole.Viewer : false

  const handleReady = useCallback((instance: Editor) => setEditor(instance), [])

  /* The URL only carries the document's id, so the shell's breadcrumb would
     read "Document". Publishing the real trail replaces it with the title, and
     threads the owning project in between when there is one. (§29, §34) */
  usePageBreadcrumbs(
    document && workspace
      ? [
          { label: 'Documents', to: routes.workspace.documents(workspace.id) },
          ...(document.projectName && document.projectId
            ? [
                {
                  label: document.projectName,
                  to: routes.workspace.project(workspace.id, document.projectId),
                },
              ]
            : []),
          { label: document.title },
        ]
      : null,
  )

  /* ⌘K is the command menu globally, but inside a focused editor it is the
     near-universal "insert link". Scoped to the editor having focus so the
     palette still works from anywhere else on the page. */
  useEffect(() => {
    if (!editor) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!hasCommandModifier(event) || event.key.toLowerCase() !== 'k') return
      if (!editor.isFocused) return

      event.preventDefault()
      event.stopPropagation()
      setLinkOpen(true)
    }

    // Capture phase, so this runs before the global shortcut handler.
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [editor])

  /* ---------------------------------------------------------------------
     Loading and failure
     --------------------------------------------------------------------- */

  if (documentQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-24">
        <ErrorState
          title="Document not available"
          error={documentQuery.error}
          action={
            workspace ? (
              <Link
                to={routes.workspace.documents(workspace.id)}
                className={buttonVariants({ variant: 'secondary' })}
              >
                All documents
              </Link>
            ) : null
          }
        />
      </div>
    )
  }

  if (documentQuery.isPending || !document || !workspace) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10" aria-busy="true">
        <span className="sr-only" role="status">
          Loading document
        </span>
        <Skeleton shape="text" className="h-4 w-48" />
        <Skeleton shape="text" className="mt-6 h-9 w-2/3" />
        <div className="mt-8 space-y-3">
          <Skeleton shape="text" className="h-4 w-full" />
          <Skeleton shape="text" className="h-4 w-11/12" />
          <Skeleton shape="text" className="h-4 w-4/5" />
          <Skeleton shape="text" className="mt-6 h-5 w-1/3" />
          <Skeleton shape="text" className="h-4 w-full" />
          <Skeleton shape="text" className="h-4 w-10/12" />
        </div>
      </div>
    )
  }

  const panelContent = () => {
    switch (panel) {
      case 'outline':
        return <DocumentOutline editor={editor} />
      case 'comments':
        return (
          <CommentsPanel
            resourceType={CommentResource.Document}
            resourceId={document.id}
            workspaceId={workspace.id}
          />
        )
      case 'history':
        return <VersionHistoryPanel documentId={document.id} />
      case 'ai':
        return (
          <AIAssistantPanel
            document={document}
            workspaceId={workspace.id}
            editor={editor}
            canEdit={canEdit}
            tab={aiTab}
            onTabChange={setAiTab}
          />
        )
      default:
        return null
    }
  }

  /** Toolbar → assistant, with the selection already in hand. (§47) */
  const openRewrite = () => {
    setAiTab(AiPanelTab.Rewrite)
    setPanel('ai')
  }

  return (
    <div className="flex min-h-full flex-col">
      <DocumentHeader
        document={document}
        participants={state.participants}
        selfId={user.id}
        connection={state.connection}
        sync={state.sync}
        lastSavedAt={state.lastSavedAt}
        disconnectReason={state.disconnectReason}
        activePanel={panel}
        onPanelChange={setPanel}
        onShare={() => setShareOpen(true)}
      />

      <div className="mx-auto flex w-full max-w-[100rem] flex-1 gap-0">
        {/* -------------------------------------------------------------
            Writing column
           ------------------------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {canEdit && editor ? (
            <div className="sticky top-[calc(var(--spacing-topbar)+4.25rem)] z-10 border-b border-border bg-background/90 px-4 py-1.5 backdrop-blur-sm sm:px-6">
              <div className="mx-auto max-w-[68ch]">
                <EditorToolbar
                  editor={editor}
                  onLinkRequest={() => setLinkOpen(true)}
                  onAiRequest={openRewrite}
                />
              </div>
            </div>
          ) : null}

          <div className="px-4 py-8 sm:px-6 lg:py-10">
            {/* The measure is capped in editor.css; this centres it. */}
            <div className="mx-auto max-w-[68ch]">
              {!canEdit ? (
                <p className="mb-6 rounded-md border border-border bg-surface-muted px-3 py-2 text-caption text-foreground-muted">
                  You have view access to this document. Ask an editor to make changes.
                </p>
              ) : null}

              <DocumentEditor
                initialContent={document.content}
                editable={canEdit}
                participants={state.participants}
                selfId={user.id}
                onReady={handleReady}
                onContentChange={pushContent}
                onCursorChange={pushCursor}
                incomingContent={remoteContent}
                onIncomingApplied={acknowledgeRemote}
              />
            </div>
          </div>
        </div>

        {/* -------------------------------------------------------------
            Side panel

            Below `lg` it becomes a full-width sheet rather than a squeezed
            column — 320px of document beside 280px of comments is neither.
           ------------------------------------------------------------- */}
        {panel ? (
          <aside
            aria-label={PANEL_LABELS[panel]}
            className={cn(
              'flex flex-col border-border bg-surface',
              'fixed inset-0 z-40 lg:static lg:z-auto',
              'lg:w-80 lg:shrink-0 lg:border-l xl:w-96',
            )}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <h2 className="text-body font-semibold text-foreground">{PANEL_LABELS[panel]}</h2>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setPanel(null)}
                aria-label={`Close ${PANEL_LABELS[panel].toLowerCase()}`}
              >
                <X aria-hidden="true" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto lg:sticky lg:top-topbar">
              {panelContent()}
            </div>
          </aside>
        ) : null}
      </div>

      <LinkDialog open={linkOpen} onOpenChange={setLinkOpen} editor={editor} />

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        documentId={document.id}
        documentTitle={document.title}
      />
    </div>
  )
}
