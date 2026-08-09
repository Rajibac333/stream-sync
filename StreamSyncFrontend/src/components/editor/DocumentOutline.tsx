import type { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/utils/cn'

/**
 * Document outline. (CLAUDE.md §40)
 *
 * Derived from the headings actually in the document rather than from a stored
 * table of contents, so it cannot go stale. Rebuilt on every transaction, which
 * is cheap — walking the heading nodes of a document a human wrote is trivial
 * next to what ProseMirror already does per keystroke.
 *
 * Selecting an entry moves the *caret*, not just the scroll position. Scrolling
 * alone leaves the user looking at a section they still cannot type in.
 */

interface OutlineEntry {
  id: string
  level: number
  text: string
  position: number
}

function readOutline(editor: Editor): OutlineEntry[] {
  const entries: OutlineEntry[] = []

  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== 'heading') return

    const text = node.textContent.trim()
    if (text === '') return

    entries.push({
      id: `${position}-${text}`,
      level: Number(node.attrs.level ?? 1),
      text,
      position,
    })
  })

  return entries
}

export function DocumentOutline({ editor }: { editor: Editor | null }) {
  const [entries, setEntries] = useState<OutlineEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (!editor) return

    const refresh = () => setEntries(readOutline(editor))
    refresh()

    // Selection changes as well as content: the highlighted entry should follow
    // the caret, not only the text.
    const trackActive = () => {
      const { from } = editor.state.selection
      const outline = readOutline(editor)
      const current = [...outline].reverse().find((entry) => entry.position <= from)
      setActiveId(current?.id ?? null)
    }

    editor.on('update', refresh)
    editor.on('selectionUpdate', trackActive)
    trackActive()

    return () => {
      editor.off('update', refresh)
      editor.off('selectionUpdate', trackActive)
    }
  }, [editor])

  if (entries.length === 0) {
    return (
      <EmptyState
        size="inline"
        title="No headings yet"
        description="Add a heading and it will show up here."
      />
    )
  }

  return (
    <nav aria-label="Document outline" className="p-1">
      <ul className="flex flex-col gap-0.5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              aria-current={entry.id === activeId ? 'location' : undefined}
              onClick={() => {
                if (!editor) return
                editor.chain().focus().setTextSelection(entry.position + 1).run()
                editor.view.dom
                  .querySelector(`h${entry.level}`)
                  ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              }}
              className={cn(
                'w-full truncate rounded-md px-2 py-1.5 text-left text-small',
                'transition-colors duration-(--duration-fast)',
                'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
                // Indentation encodes the level; the text alone would flatten
                // the document's structure into a list.
                entry.level === 2 && 'pl-5',
                entry.level >= 3 && 'pl-8',
                entry.id === activeId
                  ? 'bg-primary-subtle font-medium text-primary-subtle-foreground'
                  : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
              )}
            >
              {entry.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
