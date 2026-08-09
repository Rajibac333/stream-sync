import type { Editor } from '@tiptap/react'
import { useLayoutEffect, useState } from 'react'

import { participantsWithCursors, type ParticipantMap } from '@/websocket/presence'
import type { Participant } from '@/websocket/types'

/**
 * Collaborator carets. (CLAUDE.md §36)
 *
 * "Subtle, identifiable, labelled, non-distracting" — a 2px rule in the
 * participant's colour with a small name flag, positioned absolutely over the
 * document rather than inserted into it.
 *
 * Overlaying rather than decorating matters for more than tidiness: injecting
 * widgets into the ProseMirror document would mutate content the user owns, and
 * every remote caret move would land in their undo history.
 *
 * Positions are recomputed on every participant change and on resize, because
 * a character offset means nothing until it is mapped through the current
 * layout — the same offset sits somewhere different after a window resize or a
 * paragraph being added above it.
 */

interface CaretRect {
  participant: Participant
  top: number
  left: number
  height: number
}

export interface RemoteCursorsProps {
  editor: Editor
  participants: ParticipantMap
  selfId: string
}

export function RemoteCursors({ editor, participants, selfId }: RemoteCursorsProps) {
  const [carets, setCarets] = useState<CaretRect[]>([])

  useLayoutEffect(() => {
    const visible = participantsWithCursors(participants, selfId)

    const measure = () => {
      const container = editor.view.dom.parentElement
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const docSize = editor.state.doc.content.size

      const next: CaretRect[] = []

      for (const participant of visible) {
        const cursor = participant.cursor
        if (!cursor) continue

        // A stale offset can point past the end of a document that has since
        // shrunk; ProseMirror throws rather than clamping, so clamp here.
        const position = Math.max(0, Math.min(cursor.head, docSize))

        try {
          const coords = editor.view.coordsAtPos(position)
          next.push({
            participant,
            top: coords.top - containerRect.top,
            left: coords.left - containerRect.left,
            height: Math.max(coords.bottom - coords.top, 18),
          })
        } catch {
          // Position could not be mapped — the document changed underneath the
          // frame. Skipping one caret for one paint is invisible; throwing
          // would take the editor down.
        }
      }

      setCarets(next)
    }

    measure()

    // Reflow moves every caret, so remeasure on resize as well as on data
    // change. `ResizeObserver` on the editor catches content growth too.
    const observer = new ResizeObserver(measure)
    observer.observe(editor.view.dom)
    window.addEventListener('resize', measure)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [editor, participants, selfId])

  if (carets.length === 0) return null

  return (
    /* Decorative duplication of information already carried by the collaborator
       list and the typing indicator, so it is hidden from assistive tech — a
       screen reader announcing a caret position several times a second would be
       unusable. */
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {carets.map(({ participant, top, left, height }) => (
        <span
          key={participant.user.id}
          className="ss-remote-caret"
          style={{
            transform: `translate(${left}px, ${top}px)`,
            height,
            // Presence colours are tokens, so a caret matches that person's
            // avatar everywhere else in the app.
            ['--caret-color' as string]: `var(--ss-presence-${participant.colorIndex})`,
          }}
        >
          <span className="ss-remote-caret-label">{participant.user.name.split(' ')[0]}</span>
        </span>
      ))}
    </div>
  )
}
