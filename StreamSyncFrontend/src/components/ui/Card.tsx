import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/utils/cn'

/**
 * Card
 *
 * Bordered by default, not shadowed. Elevation is reserved for things that
 * genuinely float above the page — dialogs, popovers, toasts — so that a
 * dashboard of twenty cards reads as a calm grid rather than as twenty floating
 * panels. (CLAUDE.md §16, §31)
 */

const cardVariants = cva('rounded-lg bg-surface', {
  variants: {
    variant: {
      bordered: 'border border-border',
      elevated: 'border border-border shadow-sm',
      flat: 'bg-surface-muted',
    },
    interactive: {
      true: [
        'text-left transition-[border-color,background-color,box-shadow]',
        'duration-(--duration-fast) ease-(--ease-out-quart)',
        'hover:border-border-strong hover:bg-surface-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      ],
    },
  },
  defaultVariants: { variant: 'bordered' },
})

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, variant, interactive, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant, interactive }), className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-4 pb-3', className)} {...props} />
}

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Pick the level that fits the page outline — never for visual size alone. */
  as?: 'h2' | 'h3' | 'h4'
}

export function CardTitle({ className, as: Tag = 'h3', ...props }: CardTitleProps) {
  return <Tag className={cn('text-h3 text-foreground', className)} {...props} />
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-small text-foreground-muted', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-0', className)} {...props} />
}

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds a rule above the footer — for cards whose footer holds actions. */
  divided?: boolean
}

export function CardFooter({ className, divided = false, ...props }: CardFooterProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 p-4 pt-0',
        divided && 'mt-1 border-t border-border pt-3',
        className,
      )}
      {...props}
    />
  )
}

export interface CardToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

/** Right-aligned action slot for a card header. */
export function CardToolbar({ className, ...props }: CardToolbarProps) {
  return <div className={cn('ml-auto flex items-center gap-1', className)} {...props} />
}
