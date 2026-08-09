import { type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

import { buttonVariants } from '@/components/ui/Button.variants'
import { cn } from '@/utils/cn'

/**
 * Button
 *
 * Always renders a real <button> — never a clickable <div>, which is
 * unreachable by keyboard and announces as nothing. For something that
 * *navigates*, use a `<Link>` with `buttonVariants()` instead of a button, so
 * the element matches its behaviour. (CLAUDE.md §19)
 */

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'>,
    VariantProps<typeof buttonVariants> {
  /** Swaps content for a spinner and blocks interaction. */
  loading?: boolean
  /** Announced while `loading` — defaults to "Loading". */
  loadingLabel?: string
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  className,
  variant,
  size,
  fullWidth,
  loading = false,
  loadingLabel,
  leadingIcon,
  trailingIcon,
  children,
  disabled,
  type = 'button',
  ref,
  ...props
}: ButtonProps) {
  return (
    <button
      ref={ref}
      // Defaulting to "button" prevents the classic bug where a button inside a
      // form silently submits it.
      type={type}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          {/* The label stays mounted but invisible so the button does not
              change width mid-request, and a live region announces the state
              rather than relying on the spinner alone. */}
          <LoaderCircle className="absolute animate-spin" aria-hidden="true" />
          <span className="invisible contents">{children}</span>
          <span className="sr-only" role="status">
            {loadingLabel ?? 'Loading'}
          </span>
        </>
      ) : (
        <>
          {leadingIcon}
          {children}
          {trailingIcon}
        </>
      )}
    </button>
  )
}
