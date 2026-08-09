import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode, Ref } from 'react'

import { cn } from '@/utils/cn'

/**
 * Input
 *
 * The label, hint and error are part of the component rather than the caller's
 * responsibility. That is what guarantees the `id`/`for` pairing and the
 * `aria-describedby` wiring actually exist on every field in the app instead of
 * on the ones someone remembered. (CLAUDE.md §19, §63)
 */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  /** Supporting text. Hidden from `aria-describedby` when an error is showing. */
  hint?: string
  /** Presence of this both styles and announces the field as invalid. */
  error?: string
  leadingIcon?: ReactNode
  /** Rendered inside the field — for a password reveal toggle, clear button, etc. */
  trailingSlot?: ReactNode
  /** Keeps the label visible to screen readers only (e.g. a toolbar search). */
  hideLabel?: boolean
  containerClassName?: string
  ref?: Ref<HTMLInputElement>
}

export function Input({
  label,
  hint,
  error,
  leadingIcon,
  trailingSlot,
  hideLabel = false,
  className,
  containerClassName,
  id,
  required,
  disabled,
  ref,
  ...props
}: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`

  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label ? (
        <label
          htmlFor={inputId}
          className={cn(
            'text-small font-medium text-foreground',
            hideLabel && 'sr-only',
            disabled && 'opacity-60',
          )}
        >
          {label}
          {required ? (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}

      <div className="relative">
        {leadingIcon ? (
          <span
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-subtle [&_svg]:size-4"
            aria-hidden="true"
          >
            {leadingIcon}
          </span>
        ) : null}

        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            'h-8 w-full rounded-md border bg-surface px-2.5 text-body text-foreground',
            'transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-out-quart)',
            'placeholder:text-foreground-subtle',
            'outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-focus/25',
            'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-foreground-subtle',
            error ? 'border-danger focus-visible:border-danger focus-visible:ring-danger/25' : 'border-border-control',
            leadingIcon && 'pl-8',
            trailingSlot && 'pr-8',
            className,
          )}
          {...props}
        />

        {trailingSlot ? (
          <span className="absolute right-1 top-1/2 -translate-y-1/2">{trailingSlot}</span>
        ) : null}
      </div>

      {/* Errors are polite, not assertive: a field validating on blur should not
          interrupt whatever the user is typing next. (CLAUDE.md §63) */}
      {error ? (
        <p id={errorId} role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-caption text-foreground-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
