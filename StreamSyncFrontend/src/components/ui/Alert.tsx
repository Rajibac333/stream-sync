import { cva, type VariantProps } from 'class-variance-authority'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ComponentType, HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/utils/cn'

/**
 * Alert — inline, in-context message.
 *
 * Distinct from the other two feedback surfaces, and the distinction is worth
 * keeping straight:
 *
 *   Toast       transient, global, for something that already happened
 *   ErrorState  replaces a region that failed to load
 *   Alert       sits *inside* content that is still usable — most often a
 *               form-level failure above the fields the user must fix
 *
 * `danger` and `warning` announce as `role="alert"` because they interrupt a
 * task the user is mid-way through; informational variants use `role="status"`
 * so they are announced without cutting off whatever is being read.
 * (CLAUDE.md §61, §63)
 */

const alertVariants = cva('flex w-full items-start gap-2.5 rounded-md border p-3 text-body', {
  variants: {
    variant: {
      info: 'border-border bg-surface-muted text-foreground',
      success: 'border-success/25 bg-success-subtle text-success-subtle-foreground',
      warning: 'border-warning/25 bg-warning-subtle text-warning-subtle-foreground',
      danger: 'border-danger/25 bg-danger-subtle text-danger-subtle-foreground',
    },
  },
  defaultVariants: { variant: 'info' },
})

const VARIANT_ICONS: Record<NonNullable<AlertProps['variant']>, ComponentType<{ className?: string }>> =
  {
    info: Info,
    success: CircleCheck,
    warning: TriangleAlert,
    danger: CircleAlert,
  }

export interface AlertProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof alertVariants> {
  title?: ReactNode
  /** Replaces the variant's default icon. Pass `null` to omit it entirely. */
  icon?: ReactNode | null
  /** Trailing action, e.g. a "Resend" button. */
  action?: ReactNode
}

export function Alert({
  className,
  variant = 'info',
  title,
  icon,
  action,
  children,
  ...props
}: AlertProps) {
  const resolvedVariant = variant ?? 'info'
  const Icon = VARIANT_ICONS[resolvedVariant]
  const interrupts = resolvedVariant === 'danger' || resolvedVariant === 'warning'

  return (
    <div
      role={interrupts ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {icon === null ? null : (
        <span className="mt-px shrink-0 [&_svg]:size-4" aria-hidden="true">
          {icon ?? <Icon />}
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-small opacity-90">{children}</div> : null}
      </div>

      {action ? <div className="ml-1 shrink-0">{action}</div> : null}
    </div>
  )
}
