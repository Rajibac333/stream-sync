import { Gavel, RefreshCw, Sparkles } from 'lucide-react'

import { AIThinking } from '@/components/ai/AIThinking'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { useAiSummary } from '@/hooks/useAiAssistant'
import type { AiDocumentContext } from '@/types/ai'

/**
 * Document summary. (CLAUDE.md §48)
 *
 * Three sections, in the order somebody reading a spec actually needs them:
 * what this document is, the points it enumerates, and the decisions it
 * records. Sections with nothing in them are omitted rather than shown empty —
 * a "Key decisions" heading above nothing implies the document made none, which
 * is a claim the summariser is in no position to make.
 */

export function AISummaryView({ context }: { context: AiDocumentContext }) {
  const { summary, generate, isPending, error } = useAiSummary(context)

  if (isPending) {
    return <AIThinking label="Analyzing document" lines={4} />
  }

  if (error) {
    return (
      <ErrorState
        size="inline"
        title="Couldn't summarise this"
        description={error}
        onRetry={generate}
      />
    )
  }

  if (!summary) {
    return (
      <EmptyState
        size="inline"
        icon={<Sparkles />}
        title="Summarise this document"
        description="Pull out what it says, the points it lists, and the decisions it records."
        action={
          <Button variant="primary" onClick={generate} leadingIcon={<Sparkles aria-hidden="true" />}>
            Summarise
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="ai-summary-heading">
        <h4 id="ai-summary-heading" className="text-small font-semibold text-foreground">
          Summary
        </h4>
        <p className="mt-1.5 text-small leading-relaxed text-foreground-muted">{summary.summary}</p>
      </section>

      {summary.keyPoints.length > 0 ? (
        <section aria-labelledby="ai-keypoints-heading">
          <h4 id="ai-keypoints-heading" className="text-small font-semibold text-foreground">
            Key points
          </h4>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {summary.keyPoints.map((point) => (
              <li key={point} className="flex gap-2 text-small leading-relaxed text-foreground-muted">
                <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                <span className="min-w-0">{point}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.decisions.length > 0 ? (
        <section aria-labelledby="ai-decisions-heading">
          <h4
            id="ai-decisions-heading"
            className="flex items-center gap-1.5 text-small font-semibold text-foreground"
          >
            <Gavel aria-hidden="true" className="size-3.5 text-foreground-subtle" />
            Important decisions
          </h4>

          {/* Bordered rather than bulleted: a decision is a different kind of
              statement from a key point, and the list should not read as more
              of the same. */}
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {summary.decisions.map((decision) => (
              <li
                key={decision}
                className="rounded-md border-l-2 border-primary/40 bg-surface-muted px-2.5 py-1.5 text-small leading-relaxed text-foreground-muted"
              >
                {decision}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={generate}
          leadingIcon={<RefreshCw aria-hidden="true" />}
          className="self-start"
        >
          Summarise again
        </Button>
      </div>
    </div>
  )
}
