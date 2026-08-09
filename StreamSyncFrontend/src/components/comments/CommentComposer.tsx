import { useCallback, useId, useMemo, useRef, useState } from 'react'

import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { useMembers } from '@/hooks/useWorkspaceContent'
import type { CommentMention } from '@/types/comment'
import { cn } from '@/utils/cn'

/**
 * Comment composer with @mention autocomplete. (CLAUDE.md §39)
 *
 * The mention picker is a combobox over a textarea, which is the awkward case:
 * focus must stay in the textarea so typing keeps working, so the highlighted
 * option is tracked with `aria-activedescendant` rather than real focus —
 * exactly the pattern the command menu uses.
 *
 * Mentions are collected as structured references as they are inserted, not
 * re-parsed from the finished text. Parsing "@Raj" back to a user is ambiguous
 * the moment two people share a first name.
 */

/** Matches an in-progress mention at the caret: "@ma" but not a finished one. */
const MENTION_PATTERN = /@([\w-]*)$/

export interface CommentComposerProps {
  workspaceId: string | null
  placeholder?: string
  submitLabel?: string
  busy?: boolean
  autoFocus?: boolean
  /** Compact treatment for the reply box nested inside a thread. */
  compact?: boolean
  onSubmit: (body: string, mentions: CommentMention[]) => void
  onCancel?: () => void
}

export function CommentComposer({
  workspaceId,
  placeholder = 'Add a comment…',
  submitLabel = 'Comment',
  busy = false,
  autoFocus = false,
  compact = false,
  onSubmit,
  onCancel,
}: CommentComposerProps) {
  const { data: members } = useMembers(workspaceId)
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<CommentMention[]>([])
  const [query, setQuery] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const baseId = useId()
  const listboxId = `${baseId}-mentions`

  const candidates = useMemo(() => {
    if (query === null) return []
    const term = query.toLowerCase()
    return (members ?? [])
      .filter((member) => member.user.name.toLowerCase().includes(term))
      .slice(0, 5)
  }, [members, query])

  const open = query !== null && candidates.length > 0

  /** Reads the text before the caret to decide whether a mention is in progress. */
  const syncQuery = useCallback((value: string, caret: number) => {
    const match = MENTION_PATTERN.exec(value.slice(0, caret))
    setQuery(match ? (match[1] ?? '') : null)
    setActiveIndex(0)
  }, [])

  const insertMention = useCallback(
    (member: { user: { id: string; name: string } }) => {
      const textarea = textareaRef.current
      if (!textarea) return

      const caret = textarea.selectionStart
      const before = body.slice(0, caret)
      const after = body.slice(caret)
      const firstName = member.user.name.split(' ')[0] ?? member.user.name

      const replaced = before.replace(MENTION_PATTERN, `@${firstName} `)
      const next = replaced + after

      setBody(next)
      setMentions((current) =>
        current.some((mention) => mention.userId === member.user.id)
          ? current
          : [...current, { userId: member.user.id, name: firstName }],
      )
      setQuery(null)

      // Restore the caret after React re-renders, or it jumps to the end.
      requestAnimationFrame(() => {
        textarea.focus()
        const position = replaced.length
        textarea.setSelectionRange(position, position)
      })
    },
    [body],
  )

  const submit = () => {
    const trimmed = body.trim()
    if (trimmed === '' || busy) return

    // Only mentions still present in the final text count — someone typed and
    // then deleted is not a mention.
    const surviving = mentions.filter((mention) => trimmed.includes(`@${mention.name}`))
    onSubmit(trimmed, surviving)
    setBody('')
    setMentions([])
    setQuery(null)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          setActiveIndex((current) => (current + 1) % candidates.length)
          return
        case 'ArrowUp':
          event.preventDefault()
          setActiveIndex((current) => (current - 1 + candidates.length) % candidates.length)
          return
        case 'Enter':
        case 'Tab': {
          const member = candidates[activeIndex]
          if (member) {
            event.preventDefault()
            insertMention(member)
          }
          return
        }
        case 'Escape':
          event.preventDefault()
          setQuery(null)
          return
        default:
          break
      }
    }

    // ⌘/Ctrl+Enter submits. A bare Enter must insert a newline — a comment box
    // that posts on Enter loses half-written paragraphs.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  const activeOptionId = open ? `${baseId}-option-${activeIndex}` : undefined

  return (
    <div className="relative">
      <label htmlFor={`${baseId}-input`} className="sr-only">
        {placeholder}
      </label>

      <textarea
        ref={textareaRef}
        id={`${baseId}-input`}
        value={body}
        rows={compact ? 2 : 3}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={busy}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        aria-describedby={`${baseId}-hint`}
        onChange={(event) => {
          setBody(event.target.value)
          syncQuery(event.target.value, event.target.selectionStart)
        }}
        onKeyDown={handleKeyDown}
        onClick={(event) => syncQuery(body, event.currentTarget.selectionStart)}
        className={cn(
          'w-full resize-y rounded-md border border-border-control bg-surface px-2.5 py-2',
          'text-body text-foreground placeholder:text-foreground-subtle',
          'transition-[border-color,box-shadow] duration-(--duration-fast)',
          'outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-focus/25',
          'disabled:cursor-not-allowed disabled:bg-surface-muted',
        )}
      />

      {/* Mention picker. Anchored above the box so it never covers the text
          being written. */}
      {open ? (
        <ul
          role="listbox"
          id={listboxId}
          aria-label="Mention a teammate"
          className={cn(
            'absolute bottom-full z-20 mb-1 w-64 overflow-hidden rounded-lg',
            'border border-border bg-surface-raised p-1 shadow-lg',
          )}
        >
          {candidates.map((member, index) => (
            <li
              key={member.user.id}
              id={`${baseId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseMove={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                // mousedown, not click: click fires after blur, which would
                // close the picker before the selection lands.
                event.preventDefault()
                insertMention(member)
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-body',
                index === activeIndex
                  ? 'bg-surface-hover text-foreground'
                  : 'text-foreground-muted',
              )}
            >
              <Avatar
                size="xs"
                name={member.user.name}
                userId={member.user.id}
                src={member.user.avatarUrl}
              />
              <span className="min-w-0 flex-1 truncate">{member.user.name}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <p id={`${baseId}-hint`} className="text-caption text-foreground-subtle">
          @ to mention · ⌘↵ to post
        </p>

        <div className="flex items-center gap-1.5">
          {onCancel ? (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            onClick={submit}
            loading={busy}
            disabled={body.trim() === ''}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
