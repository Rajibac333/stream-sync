import type { ReactNode } from 'react'

import { cn } from '@/utils/cn'

/**
 * EmptyState
 *
 * An empty screen must explain itself and offer the next step. "No documents
 * yet" alone is a dead end; "No documents yet — create your first document and
 * start collaborating [Create document]" is a product.
 *
 * CLAUDE.md §60
 */

export interface EmptyStateProps {
  /** Decorative — the title carries the meaning. */
  icon?: ReactNode
  title: string
  description?: string
  /** Primary call to action. */
  action?: ReactNode
  /** Lower-emphasis alternative, e.g. "Import instead". */
  secondaryAction?: ReactNode
  /** `inline` for empty regions inside a populated page (a card, a panel). */
  size?: 'inline' | 'page'
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  size = 'page',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'page' ? 'gap-3 px-6 py-16' : 'gap-2 px-4 py-10',
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center rounded-lg border border-border bg-surface-muted',
            'text-foreground-subtle',
            size === 'page' ? 'mb-1 size-11 [&_svg]:size-5' : 'size-9 [&_svg]:size-4',
          )}
        >
          {icon}
        </div>
      ) : null}

      <h3 className={cn('text-foreground', size === 'page' ? 'text-h3' : 'text-body font-semibold')}>
        {title}
      </h3>

      {description ? (
        // Capped measure: centred text past ~60ch is genuinely hard to read.
        <p className="max-w-sm text-balance text-small text-foreground-muted">{description}</p>
      ) : null}

      {action || secondaryAction ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  )
}
