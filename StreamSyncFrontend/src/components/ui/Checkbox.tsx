import { Check } from 'lucide-react'
import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode, Ref } from 'react'

import { cn } from '@/utils/cn'

/**
 * Checkbox
 *
 * A real `<input type="checkbox">`, visually hidden and layered under a drawn
 * box via `peer`. The alternative — a div with `role="checkbox"` — has to
 * reimplement Space activation, form participation, indeterminate state and
 * autofill, and gets at least one of them wrong. Here the platform does it and
 * the styling is cosmetic.
 *
 * The whole row is the label, so the hit target is the text as well as the box.
 * (CLAUDE.md §19)
 */

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: ReactNode
  /** Supporting text below the label. */
  description?: string
  error?: string
  containerClassName?: string
  ref?: Ref<HTMLInputElement>
}

export function Checkbox({
  label,
  description,
  error,
  className,
  containerClassName,
  id,
  disabled,
  ref,
  ...props
}: CheckboxProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descriptionId = `${inputId}-description`
  const errorId = `${inputId}-error`

  const describedBy = [error ? errorId : null, description ? descriptionId : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <div className="flex items-start gap-2.5">
        <span className="relative flex items-center">
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
            // `peer` + `appearance-none` rather than `sr-only`: the input keeps
            // its own size and position, so the focus ring lands on the drawn
            // box and clicks hit the real control.
            className={cn(
              'peer size-4 shrink-0 cursor-pointer appearance-none rounded-xs border border-border-control bg-surface',
              'transition-[background-color,border-color] duration-(--duration-fast) ease-(--ease-out-quart)',
              'checked:border-primary checked:bg-primary',
              'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
              'focus-visible:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-50',
              error && 'border-danger',
              className,
            )}
            {...props}
          />

          <Check
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute left-0 top-0 size-4 p-px text-primary-foreground',
              'opacity-0 peer-checked:opacity-100',
            )}
            strokeWidth={3}
          />
        </span>

        <label
          htmlFor={inputId}
          className={cn(
            'select-none text-body text-foreground',
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          )}
        >
          {label}
          {description ? (
            <span id={descriptionId} className="mt-0.5 block text-caption text-foreground-muted">
              {description}
            </span>
          ) : null}
        </label>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
