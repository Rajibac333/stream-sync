import { cn } from '@/utils/cn'

/**
 * Skip-to-content link.
 *
 * The first thing in the tab order, and visible only when focused. Without it a
 * keyboard user has to tab through the entire sidebar — a dozen links, the
 * workspace switcher, search, notifications — on every single page before
 * reaching the content they came for. (CLAUDE.md §19)
 */

export const MAIN_CONTENT_ID = 'main-content'

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className={cn(
        // Positioned off-screen rather than `display: none`, because a hidden
        // element is not focusable and this link's entire job is to be focused.
        'fixed left-3 top-3 z-[70] -translate-y-16 rounded-md bg-primary px-3 py-2',
        'text-body font-medium text-primary-foreground shadow-lg',
        'transition-transform duration-(--duration-fast) ease-(--ease-out-quart)',
        'focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2',
        'focus:ring-offset-background',
      )}
    >
      Skip to content
    </a>
  )
}
