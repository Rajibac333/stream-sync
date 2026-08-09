import { Sparkles } from 'lucide-react'

import { cn } from '@/utils/cn'

/**
 * The waiting state for an AI operation. (CLAUDE.md §59)
 *
 * Two jobs. It says what is happening in words — "Analyzing document…" —
 * because a spinner alone tells a user nothing about how long to wait or what
 * they will get. And it occupies roughly the shape of the answer, so the panel
 * does not jump when the result lands.
 *
 * Announced once via `role="status"`. The shimmer is `aria-hidden`: a screen
 * reader should hear the sentence, not a description of three grey bars. The
 * animation is neutralised globally under `prefers-reduced-motion`. (§20)
 */

export interface AIThinkingProps {
  /** Present continuous, e.g. "Analyzing document". */
  label: string
  /** Number of placeholder lines — match the result's rough height. */
  lines?: number
  className?: string
}

export function AIThinking({ label, lines = 3, className }: AIThinkingProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)} aria-busy="true">
      <p role="status" className="flex items-center gap-2 text-small text-foreground-muted">
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-subtle-foreground"
        >
          <Sparkles className="size-3.5 animate-pulse" />
        </span>
        {label}…
      </p>

      <div aria-hidden="true" className="flex flex-col gap-2 pl-8">
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-3 animate-pulse rounded-sm bg-surface-muted',
              index === lines - 1 ? 'w-3/5' : 'w-full',
            )}
            // Staggered so the block reads as one object settling rather than
            // three unrelated bars flashing in unison.
            style={{ animationDelay: `${index * 120}ms` }}
          />
        ))}
      </div>
    </div>
  )
}
