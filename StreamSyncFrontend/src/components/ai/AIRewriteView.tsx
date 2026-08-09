import type { Editor } from '@tiptap/react'
import { Check, Copy, PenLine, Shrink, StretchHorizontal, Wand2 } from 'lucide-react'
import { useState } from 'react'

import { AIThinking } from '@/components/ai/AIThinking'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Select'
import { useAiRewrite } from '@/hooks/useAiAssistant'
import { useEditorSelection } from '@/hooks/useEditorSelection'
import { toast } from '@/store/toastStore'
import {
  AI_TONE_LABELS,
  AiRewriteMode,
  AiTone,
  type AiDocumentContext,
} from '@/types/ai'

/**
 * Rewrite the selection. (CLAUDE.md §47)
 *
 * Selection-scoped by design: this operates on the passage the user pointed at,
 * never on the whole document, so the blast radius of accepting a suggestion is
 * exactly what they highlighted.
 *
 * Nothing is applied without a second click. The result is shown next to the
 * original and the user decides — which is the difference between an assistant
 * and something editing your document over your shoulder.
 */

const MODES = [
  { mode: AiRewriteMode.Improve, label: 'Improve clarity', icon: Wand2 },
  { mode: AiRewriteMode.Shorten, label: 'Shorten', icon: Shrink },
  { mode: AiRewriteMode.Expand, label: 'Expand', icon: StretchHorizontal },
] as const

const TONE_OPTIONS = Object.entries(AI_TONE_LABELS).map(([value, label]) => ({ value, label }))

/** The range a rewrite was requested for, captured when it was requested. */
interface Target {
  from: number
  to: number
  text: string
}

export interface AIRewriteViewProps {
  context: AiDocumentContext
  editor: Editor | null
  canEdit: boolean
}

export function AIRewriteView({ context, editor, canEdit }: AIRewriteViewProps) {
  const selection = useEditorSelection(editor)
  const rewrite = useAiRewrite(context)

  const [tone, setTone] = useState<AiTone>(AiTone.Professional)
  const [target, setTarget] = useState<Target | null>(null)

  const result = rewrite.data ?? null

  const request = (mode: AiRewriteMode, requestedTone: AiTone | null = null) => {
    if (selection.isEmpty) return

    /* The range is captured now, not read at apply time. The document is
       collaborative — a remote edit can move these positions between asking and
       applying, and `apply` checks the text still matches before overwriting. */
    setTarget({ from: selection.from, to: selection.to, text: selection.text })
    rewrite.mutate({ text: selection.text, mode, tone: requestedTone })
  }

  const apply = () => {
    if (!editor || !result || !target) return

    const current = editor.state.doc.textBetween(target.from, target.to, ' ', ' ').trim()

    if (current !== target.text) {
      toast.error({
        title: 'That passage has changed',
        description: 'Someone edited it while this was generating. Select it again and retry.',
      })
      return
    }

    editor
      .chain()
      .focus()
      .deleteRange({ from: target.from, to: target.to })
      /* Escaped before insertion. Whatever answered behind the endpoint — a
         model or the deterministic fallback — its output is untrusted text,
         and text inserted as HTML is markup somebody else chose. (§66) */
      .insertContent(escapeHtml(result.text))
      .run()

    toast.success({ title: 'Rewrite applied', description: 'Undo with ⌘Z if it is not right.' })
    reset()
  }

  const copy = () => {
    if (!result) return
    void navigator.clipboard
      ?.writeText(result.text)
      .then(() => toast.success({ title: 'Copied to clipboard' }))
      .catch(() => toast.error({ title: "Couldn't copy that" }))
  }

  const reset = () => {
    rewrite.reset()
    setTarget(null)
  }

  /* ---------------------------------------------------------------------
     No selection — the precondition, explained rather than left to guess
     --------------------------------------------------------------------- */

  if (selection.isEmpty && !rewrite.isPending && !result) {
    return (
      <EmptyState
        size="inline"
        icon={<PenLine />}
        title="Select something to rewrite"
        description="Highlight a sentence or a paragraph in the document, and the options appear here."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="ai-rewrite-source">
        <h4
          id="ai-rewrite-source"
          className="flex items-baseline justify-between gap-2 text-small font-semibold text-foreground"
        >
          Selected text
          <span className="text-caption font-normal text-foreground-subtle">
            {countWords(target?.text ?? selection.text)} words
          </span>
        </h4>

        <blockquote className="mt-1.5 max-h-32 overflow-y-auto rounded-md border-l-2 border-border bg-surface-muted px-2.5 py-2 text-small leading-relaxed text-foreground-muted">
          {target?.text ?? selection.text}
        </blockquote>
      </section>

      {rewrite.isPending ? <AIThinking label="Rewriting the selection" lines={3} /> : null}

      {result ? (
        <section aria-labelledby="ai-rewrite-result" className="flex flex-col gap-2">
          <h4 id="ai-rewrite-result" className="text-small font-semibold text-foreground">
            Suggested rewrite
          </h4>

          {result.changed ? (
            <p className="rounded-md border border-primary/30 bg-primary-subtle/40 px-2.5 py-2 text-small leading-relaxed text-foreground">
              {result.text}
            </p>
          ) : (
            // A pass that found nothing says so. Presenting the input back as a
            // "rewrite" would be the panel pretending to have done something.
            <Alert variant="info">{result.note}</Alert>
          )}

          {result.changed ? (
            <p className="text-caption text-foreground-subtle">{result.note}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {result.changed ? (
              <Button
                variant="primary"
                size="sm"
                disabled={!canEdit}
                onClick={apply}
                leadingIcon={<Check aria-hidden="true" />}
              >
                Apply
              </Button>
            ) : null}

            <Button
              variant="secondary"
              size="sm"
              onClick={copy}
              leadingIcon={<Copy aria-hidden="true" />}
            >
              Copy
            </Button>

            <Button variant="ghost" size="sm" onClick={reset}>
              Discard
            </Button>
          </div>

          {!canEdit ? (
            <p className="text-caption text-foreground-subtle">
              You have view access, so this can’t be applied — copy it instead.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ---------------------------------------------------------------
          Actions. Kept below the result so the panel does not reorder
          itself under the cursor when a rewrite lands.
         --------------------------------------------------------------- */}
      <section aria-labelledby="ai-rewrite-actions" className="flex flex-col gap-2 border-t border-border pt-3">
        <h4 id="ai-rewrite-actions" className="text-small font-semibold text-foreground">
          {result ? 'Try something else' : 'What should I do?'}
        </h4>

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {MODES.map(({ mode, label, icon: Icon }) => (
            <Button
              key={mode}
              variant="secondary"
              size="sm"
              disabled={selection.isEmpty || rewrite.isPending}
              onClick={() => request(mode)}
              leadingIcon={<Icon aria-hidden="true" />}
              className="justify-start"
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="flex items-end gap-1.5">
          <Select
            label="Tone"
            hideLabel
            value={tone}
            options={TONE_OPTIONS}
            disabled={selection.isEmpty || rewrite.isPending}
            onChange={(event) => setTone(event.target.value as AiTone)}
            containerClassName="min-w-0 flex-1"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={selection.isEmpty || rewrite.isPending}
            onClick={() => request(AiRewriteMode.Tone, tone)}
            className="h-8 shrink-0"
          >
            Change tone
          </Button>
        </div>

        {selection.isEmpty ? (
          <p className="text-caption text-foreground-subtle">
            Select text in the document to enable these.
          </p>
        ) : null}
      </section>
    </div>
  )
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
}

/** Renders text as text. See the call site for why this is not optional. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
