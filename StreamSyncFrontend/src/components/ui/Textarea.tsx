import { useId } from 'react'
import type { Ref, TextareaHTMLAttributes } from 'react'

import { cn } from '@/utils/cn'

/** Textarea — same label/hint/error contract as {@link Input}. */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
  hideLabel?: boolean
  /** Shows a live `n / max` counter. Requires `maxLength`. */
  showCount?: boolean
  containerClassName?: string
  ref?: Ref<HTMLTextAreaElement>
}

export function Textarea({
  label,
  hint,
  error,
  hideLabel = false,
  showCount = false,
  className,
  containerClassName,
  id,
  required,
  disabled,
  maxLength,
  value,
  rows = 4,
  ref,
  ...props
}: TextareaProps) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  const hintId = `${textareaId}-hint`
  const errorId = `${textareaId}-error`

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')
  const length = typeof value === 'string' ? value.length : 0

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label ? (
        <label
          htmlFor={textareaId}
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

      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        disabled={disabled}
        required={required}
        maxLength={maxLength}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          'w-full resize-y rounded-md border bg-surface px-2.5 py-2 text-body text-foreground',
          'transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-out-quart)',
          'placeholder:text-foreground-subtle',
          'outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-focus/25',
          'disabled:cursor-not-allowed disabled:resize-none disabled:bg-surface-muted disabled:text-foreground-subtle',
          error ? 'border-danger focus-visible:border-danger focus-visible:ring-danger/25' : 'border-border-control',
          className,
        )}
        {...props}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
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

        {showCount && maxLength !== undefined ? (
          <p
            className={cn(
              'shrink-0 text-caption tabular-nums text-foreground-subtle',
              length >= maxLength && 'text-danger',
            )}
            // Counting up on every keystroke would flood a screen reader.
            aria-live="off"
          >
            {length} / {maxLength}
          </p>
        ) : null}
      </div>
    </div>
  )
}
