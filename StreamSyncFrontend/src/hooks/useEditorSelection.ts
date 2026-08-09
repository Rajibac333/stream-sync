import type { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'

/**
 * The editor's current selection, as plain text.
 *
 * ProseMirror keeps its selection when DOM focus moves elsewhere, which is what
 * makes the AI panel workable: you select a paragraph, click into the panel,
 * and the range is still there to rewrite. `from`/`to` are returned alongside
 * the text so the caller can verify the range still holds the same words before
 * writing over it — the document is collaborative, and a remote edit can shift
 * positions between asking and applying. (CLAUDE.md §47, §56)
 *
 * Plain text, never HTML. What comes back from a rewrite is inserted into the
 * document, and text that cannot carry markup cannot carry markup somebody
 * else authored.
 */

export interface EditorSelection {
  text: string
  from: number
  to: number
  isEmpty: boolean
}

const EMPTY: EditorSelection = { text: '', from: 0, to: 0, isEmpty: true }

export function useEditorSelection(editor: Editor | null): EditorSelection {
  const [selection, setSelection] = useState<EditorSelection>(EMPTY)

  useEffect(() => {
    if (!editor) {
      setSelection(EMPTY)
      return
    }

    const read = () => {
      const { from, to, empty } = editor.state.selection
      const text = empty ? '' : editor.state.doc.textBetween(from, to, ' ', ' ').trim()

      setSelection((current) =>
        // Guarded: `transaction` fires on every keystroke, and returning a new
        // object each time would re-render the whole panel as the user types.
        current.from === from && current.to === to && current.text === text
          ? current
          : { text, from, to, isEmpty: empty || text.length === 0 },
      )
    }

    read()
    editor.on('selectionUpdate', read)
    // Also on transaction: an edit inside the selection changes the text
    // without changing the range.
    editor.on('transaction', read)

    return () => {
      editor.off('selectionUpdate', read)
      editor.off('transaction', read)
    }
  }, [editor])

  return selection
}
