import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useId, type ReactNode } from 'react'

import { cn } from '@/utils/cn'

/**
 * A titled region of a page.
 *
 * Renders a real <section> labelled by its own heading, so the dashboard is
 * navigable by landmark and region instead of being one undifferentiated blob
 * of divs to a screen reader. (CLAUDE.md §19)
 *
 * Not a Card: most sections here sit directly on the canvas, with hierarchy
 * coming from the heading and spacing. Wrapping every one in a bordered box is
 * exactly the "wall of cards" §31 warns against — pass `boxed` for the few that
 * genuinely benefit from containment.
 */

export interface SectionProps {
  title: string
  /** Small count or status shown beside the title. */
  meta?: ReactNode
  description?: string
  /** Link to the full list, e.g. "All projects". */
  href?: string
  linkLabel?: string
  /** Arbitrary trailing control — a filter, a button. Wins over `href`. */
  action?: ReactNode
  children: ReactNode
  boxed?: boolean
  className?: string
  /** `h2` by default; use `h3` when nested under another titled region. */
  headingLevel?: 'h2' | 'h3'
}

export function Section({
  title,
  meta,
  description,
  href,
  linkLabel = 'View all',
  action,
  children,
  boxed = false,
  className,
  headingLevel: Heading = 'h2',
}: SectionProps) {
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        boxed && 'rounded-lg border border-border bg-surface',
        className,
      )}
    >
      <header
        className={cn(
          'flex items-center gap-3',
          boxed ? 'border-b border-border px-4 py-3' : 'mb-3',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline gap-2">
            <Heading id={headingId} className="truncate text-body font-semibold text-foreground">
              {title}
            </Heading>
            {meta ? (
              <span className="shrink-0 text-caption tabular-nums text-foreground-subtle">
                {meta}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-0.5 truncate text-caption text-foreground-muted">{description}</p>
          ) : null}
        </div>

        {action ??
          (href ? (
            <Link
              to={href}
              className={cn(
                'group flex shrink-0 items-center gap-1 rounded-sm px-1 py-0.5 text-caption font-medium',
                'text-foreground-muted transition-colors duration-(--duration-fast)',
                'hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus',
              )}
            >
              {linkLabel}
              <ArrowRight
                className="size-3 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
                aria-hidden="true"
              />
              <span className="sr-only">— {title}</span>
            </Link>
          ) : null)}
      </header>

      <div className={cn(boxed && 'p-1.5')}>{children}</div>
    </section>
  )
}
