import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/utils/cn'

/**
 * Badge — compact status / metadata label.
 *
 * Colour alone is never the message: every status variant is paired with a text
 * label, and the optional `dot` is decorative. A user who cannot distinguish
 * the red from the green still reads "Blocked". (CLAUDE.md §19)
 */

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap font-medium [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-muted text-foreground-muted',
        primary: 'bg-primary-subtle text-primary-subtle-foreground',
        success: 'bg-success-subtle text-success-subtle-foreground',
        warning: 'bg-warning-subtle text-warning-subtle-foreground',
        danger: 'bg-danger-subtle text-danger-subtle-foreground',
        outline: 'border border-border text-foreground-muted',
      },
      size: {
        sm: 'h-5 rounded-sm px-1.5 text-caption',
        md: 'h-6 rounded-md px-2 text-caption',
      },
    },
    defaultVariants: {
      variant: 'neutral',
      size: 'md',
    },
  },
)

const DOT_COLORS = {
  neutral: 'bg-muted',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  outline: 'bg-muted',
} as const

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Leading status dot. Decorative — the label carries the meaning. */
  dot?: boolean
  icon?: ReactNode
}

export function Badge({
  className,
  variant = 'neutral',
  size,
  dot = false,
  icon,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot ? (
        <span
          className={cn('size-1.5 shrink-0 rounded-full', DOT_COLORS[variant ?? 'neutral'])}
          aria-hidden="true"
        />
      ) : null}
      {icon}
      {children}
    </span>
  )
}
