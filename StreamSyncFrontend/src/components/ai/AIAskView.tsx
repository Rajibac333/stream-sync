import { CornerDownLeft, Info, MessageCircleQuestion, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AIThinking } from '@/components/ai/AIThinking'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { useAiConversation } from '@/hooks/useAiAssistant'
import { AiMessageRole, type AiDocumentContext, type AiMessage } from '@/types/ai'
import { cn } from '@/utils/cn'

/**
 * Ask about this document. (CLAUDE.md §47)
 *
 * Explicitly *not* a chat window that happens to sit in a document. The scope
 * is one document, it says so, and an answer it cannot ground in the text is
 * returned as "this document doesn't cover that" rather than as a guess. That
 * refusal is the feature: an assistant which answers anything is a chatbot, and
 * §47 rules that out in as many words.
 *
 * Rendered as question-and-answer pairs rather than opposing bubbles. Bubbles
 * would make it look like the messaging app it is not, and at 320px they waste
 * a third of the width on alignment.
 */

const STARTERS: readonly string[] = [
  'What decisions have been made?',
  'What is still open?',
  'What does this say about scope?',
]

export function AIAskView({ context }: { context: AiDocumentContext }) {
  const { messages, ask, isPending, error, clear } = useAiConversation(context)
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  /* Keeps the newest turn in view. Only when something arrives — scrolling on
     every render would fight a user reading back through the thread. */
  useEffect(() => {
    if (messages.length > 0) endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length, isPending])

  const submit = (question: string) => {
    const trimmed = question.trim()
    if (!trimmed || isPending) return
    ask(trimmed)
    setDraft('')
  }

  return (
    <div className="flex min-h-full flex-col gap-4">
      {messages.length === 0 && !isPending ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface-muted text-foreground-subtle [&_svg]:size-4"
            >
              <MessageCircleQuestion />
            </span>
            <h4 className="text-body font-semibold text-foreground">Ask about this document</h4>
            <p className="max-w-xs text-balance text-small text-foreground-muted">
              Answers come from what is written in “{context.title}” — nothing else.
            </p>
          </div>

          <ul className="flex flex-col gap-1.5">
            {STARTERS.map((question) => (
              <li key={question}>
                <button
                  type="button"
                  onClick={() => submit(question)}
                  className={cn(
                    'w-full rounded-md border border-border bg-surface px-2.5 py-2 text-left',
                    'text-small text-foreground-muted',
                    'transition-[border-color,color] duration-(--duration-fast)',
                    'hover:border-border-strong hover:text-foreground',
                    'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  )}
                >
                  {question}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="flex flex-col gap-4">
          {messages.map((message) => (
            <MessageTurn key={message.id} message={message} />
          ))}
        </ol>
      )}

      {isPending ? <AIThinking label="Reading the document" lines={2} /> : null}

      {error ? (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}

      <div ref={endRef} />

      {/* Sticky so a long thread never scrolls the input out of reach. */}
      <div className="sticky bottom-0 mt-auto flex flex-col gap-1.5 bg-surface pt-2">
        <Textarea
          label="Your question"
          hideLabel
          rows={2}
          value={draft}
          maxLength={500}
          placeholder="Ask about this document…"
          disabled={isPending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line — the convention for a
            // composer this size, and the one people try first.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit(draft)
            }
          }}
        />

        <div className="flex items-center justify-between gap-2">
          {messages.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              leadingIcon={<Trash2 aria-hidden="true" />}
            >
              Clear
            </Button>
          ) : (
            <span className="text-caption text-foreground-subtle">Enter to send</span>
          )}

          <Button
            variant="primary"
            size="sm"
            disabled={draft.trim().length === 0}
            loading={isPending}
            loadingLabel="Thinking"
            onClick={() => submit(draft)}
            trailingIcon={<CornerDownLeft aria-hidden="true" />}
          >
            Ask
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageTurn({ message }: { message: AiMessage }) {
  if (message.role === AiMessageRole.User) {
    return (
      <li>
        <p className="text-small font-semibold leading-snug text-foreground">{message.content}</p>
      </li>
    )
  }

  return (
    <li className="border-l-2 border-border pl-3">
      {message.grounded ? (
        <p className="text-small leading-relaxed text-foreground-muted">{message.content}</p>
      ) : (
        <p className="flex items-start gap-1.5 text-small leading-relaxed text-foreground-subtle">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {message.content}
        </p>
      )}

      {message.citations.length > 0 ? (
        <div className="mt-2">
          <p className="text-caption font-medium text-foreground-subtle">Also relevant</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {message.citations.map((citation) => (
              <li key={citation.quote} className="text-caption leading-relaxed text-foreground-subtle">
                {citation.section ? (
                  <span className="font-medium text-foreground-muted">{citation.section}: </span>
                ) : null}
                {citation.quote}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  )
}
