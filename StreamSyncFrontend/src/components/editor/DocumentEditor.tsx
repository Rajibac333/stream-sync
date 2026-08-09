import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { useEffect, useRef } from 'react'

import { RemoteCursors } from '@/components/editor/RemoteCursors'
import type { ParticipantMap } from '@/websocket/presence'
import type { CursorPosition } from '@/websocket/types'
import { cn } from '@/utils/cn'

/**
 * The editing surface. (CLAUDE.md §34)
 *
 * Tiptap over ProseMirror — a mature framework, as §34 requires, rather than a
 * rich-text engine written here. StarterKit v3 already ships every mark and
 * node the brief lists (headings, bold, italic, underline, both lists, links,
 * code blocks, blockquote, undo/redo), so no extension soup is needed.
 *
 * This component knows nothing about WebSockets. It reports content and caret
 * changes upward and renders whatever participants it is given; the transport
 * lives in `useDocumentSession`. (Rule 8)
 */

export interface DocumentEditorProps {
  initialContent: string
  editable: boolean
  participants: ParticipantMap
  selfId: string
  onReady: (editor: Editor) => void
  onContentChange: (html: string) => void
  onCursorChange: (cursor: CursorPosition) => void
  /** Remote edit to apply. Replacing content is destructive, so it is explicit. */
  incomingContent: { content: string; revision: number } | null
  onIncomingApplied: () => void
}

export function DocumentEditor({
  initialContent,
  editable,
  participants,
  selfId,
  onReady,
  onContentChange,
  onCursorChange,
  incomingContent,
  onIncomingApplied,
}: DocumentEditorProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    editable,
    content: initialContent,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          // `noopener` matters: a target=_blank link without it hands the
          // opened page a reference back to this window.
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        },
      }),
    ],
    editorProps: {
      attributes: {
        // Tiptap owns this DOM, so the prose styles are applied by class here
        // rather than by wrapping it in JSX.
        class: 'ss-prose',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Document body',
        'data-placeholder': 'Start writing…',
      },
    },
    onUpdate: ({ editor: instance }) => {
      onContentChange(instance.getHTML())
    },
    onSelectionUpdate: ({ editor: instance }) => {
      const { from, to } = instance.state.selection
      onCursorChange({ anchor: from, head: to })
    },
    // React 19 strict mode double-invokes effects; letting Tiptap render
    // immediately avoids a first-paint flash of an empty document.
    immediatelyRender: false,
  })

  useEffect(() => {
    if (editor) onReady(editor)
  }, [editor, onReady])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  /**
   * Applies a remote edit.
   *
   * `emitUpdate: false` stops the applied content bouncing straight back out as
   * a local change, which would loop. The caret is restored afterwards because
   * `setContent` resets the selection to the document start — losing someone's
   * place every time a colleague types is the fastest way to make a
   * collaborative editor unusable.
   *
   * This is a wholesale replacement, which is what last-write-wins means. A
   * CRDT or OT layer would merge here instead; see documentSync.ts, which is
   * explicit that neither is implemented. (§56, §82)
   */
  useEffect(() => {
    if (!editor || !incomingContent) return

    const { from, to } = editor.state.selection
    editor.commands.setContent(incomingContent.content, { emitUpdate: false })

    // `setTextSelection` takes a ProseMirror Range ({ from, to }), and the
    // positions are clamped because the incoming document may be shorter than
    // the one the caret was measured against.
    const size = editor.state.doc.content.size
    editor.commands.setTextSelection({
      from: Math.min(from, size),
      to: Math.min(to, size),
    })

    onIncomingApplied()
  }, [editor, incomingContent, onIncomingApplied])

  return (
    <div ref={surfaceRef} className={cn('relative')}>
      <EditorContent editor={editor} />

      {/* Overlaid, not interleaved: painting carets into the document would
          mean mutating content the user owns. */}
      {editor ? (
        <RemoteCursors editor={editor} participants={participants} selfId={selfId} />
      ) : null}
    </div>
  )
}
