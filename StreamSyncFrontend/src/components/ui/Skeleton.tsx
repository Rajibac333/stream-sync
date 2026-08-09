import type { HTMLAttributes } from 'react'

import { cn } from '@/utils/cn'

/**
 * Skeleton — placeholder for content that is loading.
 *
 * Hidden from assistive tech entirely. A screen-reader user should hear the
 * container's `aria-busy`/live-region announcement once, not a stream of empty
 * boxes. Use {@link SkeletonText} for multi-line blocks. (CLAUDE.md §59)
 */

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** `text` matches a line of body copy; `circle` for avatars. */
  shape?: 'block' | 'text' | 'circle'
}

export function Skeleton({ className, shape = 'block', ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-surface-muted',
        shape === 'block' && 'rounded-md',
        shape === 'text' && 'h-4 rounded-sm',
        shape === 'circle' && 'rounded-full',
        className,
      )}
      {...props}
    />
  )
}

export interface SkeletonTextProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number
}

export function SkeletonText({ lines = 3, className, ...props }: SkeletonTextProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)} {...props}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          shape="text"
          // Ragged final line reads as prose rather than as a stack of bars.
          className={index === lines - 1 ? 'w-3/5' : 'w-full'}
        />
      ))}
    </div>
  )
}
