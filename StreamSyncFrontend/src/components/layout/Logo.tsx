import { cn } from '@/utils/cn'

/**
 * StreamSync brand mark.
 *
 * Two overlapping rounded squares — one solid, one translucent — reading as two
 * views of the same thing converging. Geometric rather than illustrative so it
 * survives 16px, and drawn in `currentColor` so it inherits whatever surface it
 * sits on instead of needing a light and a dark asset.
 *
 * Original to StreamSync: CLAUDE.md §2 asks for inspiration from products like
 * Linear and Vercel, explicitly not imitation of them.
 */

export interface LogoProps {
  className?: string
  /** Decorative by default — pass a label when the mark stands alone. */
  label?: string
}

export function LogoMark({ className, label }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-6', className)}
      fill="currentColor"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <rect x="2.5" y="2.5" width="13" height="13" rx="4" />
      <rect x="8.5" y="8.5" width="13" height="13" rx="4" fillOpacity="0.45" />
    </svg>
  )
}

export interface WordmarkProps {
  className?: string
  /** Hides the text, leaving the mark — for the collapsed sidebar rail. */
  markOnly?: boolean
}

/** The mark plus the product name, as used in the sidebar and auth screens. */
export function Wordmark({ className, markOnly = false }: WordmarkProps) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-foreground', className)}>
      <LogoMark className="size-6 shrink-0 text-primary" />
      <span
        className={cn(
          'text-body-lg font-semibold tracking-[-0.02em]',
          // Hidden visually but kept in the accessible tree: the collapsed rail
          // still needs to announce which product this is.
          markOnly && 'sr-only',
        )}
      >
        StreamSync
      </span>
    </span>
  )
}
