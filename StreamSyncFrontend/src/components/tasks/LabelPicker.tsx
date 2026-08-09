import { Check } from 'lucide-react'

import { Skeleton } from '@/components/ui/Skeleton'
import type { TaskLabel } from '@/types/task'
import { cn } from '@/utils/cn'

/**
 * Label multi-select. (CLAUDE.md §42, §43)
 *
 * Built from real `<input type="checkbox">` elements inside a `<fieldset>`
 * rather than buttons with `aria-pressed`. Both can be made accessible, but
 * only the checkbox group announces itself as "Labels, group" with each option
 * reporting checked state — which is what a multi-select actually is, and what
 * a screen-reader user needs to understand they may pick more than one.
 *
 * The inputs are visually hidden and the chip is styled off `peer-checked`, so
 * the platform keeps ownership of focus, keyboard and state while the chip is
 * free to look like a chip. Selection is never conveyed by colour alone — a
 * tick appears too.
 */

export interface LabelPickerProps {
  labels: readonly TaskLabel[]
  /** Selected ids. Controlled — the caller owns the array. */
  value: readonly string[]
  onChange: (labelIds: string[]) => void
  legend?: string
  /** Disables the whole group while a save is in flight. */
  disabled?: boolean
  className?: string
}

export function LabelPicker({
  labels,
  value,
  onChange,
  legend = 'Labels',
  disabled = false,
  className,
}: LabelPickerProps) {
  const toggle = (labelId: string) => {
    onChange(
      value.includes(labelId)
        ? value.filter((id) => id !== labelId)
        : [...value, labelId],
    )
  }

  if (labels.length === 0) {
    return (
      <p className={cn('text-caption text-foreground-subtle', className)}>
        This workspace has no labels yet.
      </p>
    )
  }

  return (
    <fieldset className={cn('min-w-0', className)} disabled={disabled}>
      <legend className="mb-1.5 text-small font-medium text-foreground">{legend}</legend>

      <div className="flex flex-wrap gap-1.5">
        {labels.map((label) => {
          const checked = value.includes(label.id)

          return (
            <label
              key={label.id}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1',
                'text-caption transition-colors duration-(--duration-fast)',
                // Ring is driven by the real input's focus state.
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus has-[:focus-visible]:ring-offset-1',
                'has-[:focus-visible]:ring-offset-background',
                checked
                  ? 'border-primary-border bg-primary-subtle text-primary-subtle-foreground'
                  : 'border-border text-foreground-muted hover:border-border-strong hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => toggle(label.id)}
              />
              <Check
                aria-hidden="true"
                className={cn('size-3 shrink-0 transition-opacity', checked ? 'opacity-100' : 'opacity-0')}
              />
              {label.name}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function LabelPickerSkeleton() {
  return (
    <div className="flex flex-wrap gap-1.5" aria-hidden="true">
      <Skeleton className="h-6 w-20 rounded-md" />
      <Skeleton className="h-6 w-16 rounded-md" />
      <Skeleton className="h-6 w-24 rounded-md" />
    </div>
  )
}
