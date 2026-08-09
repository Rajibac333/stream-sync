import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import type { Ref, SelectHTMLAttributes } from 'react'

import { cn } from '@/utils/cn'

/**
 * Select
 *
 * Wraps the native <select> rather than reimplementing a listbox. That is a
 * deliberate trade: a custom listbox would let us style the option list, but
 * the native control brings correct type-ahead, correct screen-reader
 * semantics, and — the reason that actually decides it — the platform picker on
 * mobile, which no div-based menu matches for usability at 320px. (§18, §19)
 *
 * The richer combobox needed by the command menu and assignee pickers is a
 * different component with different semantics, and arrives with those
 * features.
 */

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string
  hint?: string
  error?: string
  hideLabel?: boolean
  options: readonly SelectOption[]
  /** Renders a disabled first option — use for "Select a role…". */
  placeholder?: string
  containerClassName?: string
  ref?: Ref<HTMLSelectElement>
}

export function Select({
  label,
  hint,
  error,
  hideLabel = false,
  options,
  placeholder,
  className,
  containerClassName,
  id,
  required,
  disabled,
  defaultValue,
  value,
  ref,
  ...props
}: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const hintId = `${selectId}-hint`
  const errorId = `${selectId}-error`

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  // An uncontrolled select with a placeholder needs the empty value selected
  // initially, otherwise the browser picks the first real option.
  const resolvedDefault =
    value === undefined && defaultValue === undefined && placeholder ? '' : defaultValue

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label ? (
        <label
          htmlFor={selectId}
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
        <select
          ref={ref}
          id={selectId}
          disabled={disabled}
          required={required}
          value={value}
          defaultValue={resolvedDefault}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            'h-8 w-full appearance-none rounded-md border bg-surface pl-2.5 pr-8 text-body text-foreground',
            'transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-out-quart)',
            'outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-focus/25',
            'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-foreground-subtle',
            error ? 'border-danger focus-visible:border-danger focus-visible:ring-danger/25' : 'border-border-control',
            className,
          )}
          {...props}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>

        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
          aria-hidden="true"
        />
      </div>

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
