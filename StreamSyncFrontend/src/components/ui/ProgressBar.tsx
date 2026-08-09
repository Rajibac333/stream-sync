import { cn } from '@/utils/cn'

/**
 * ProgressBar
 *
 * A real `role="progressbar"` with its ARIA value attributes, so completion is
 * announced rather than being a coloured rectangle that assistive tech skips
 * entirely. The visible percentage text is the same number, which keeps the
 * information available without relying on the bar at all. (CLAUDE.md §19)
 */

export interface ProgressBarProps {
  /** 0–100. Clamped, so bad data cannot overflow the track. */
  value: number
  /** What is progressing, e.g. "Checkout Revamp". Used for the accessible name. */
  label: string
  size?: 'sm' | 'md'
  /** Completed bars go green; everything else uses the primary tone. */
  tone?: 'primary' | 'success'
  className?: string
}

export function ProgressBar({
  value,
  label,
  size = 'sm',
  tone = 'primary',
  className,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${label} — ${clamped}% complete`}
      className={cn(
        'w-full overflow-hidden rounded-full bg-surface-muted',
        size === 'sm' ? 'h-1' : 'h-1.5',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-(--duration-slow) ease-(--ease-out-quart)',
          tone === 'success' ? 'bg-success' : 'bg-primary',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
