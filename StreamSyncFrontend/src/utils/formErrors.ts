import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'

import { isApiError } from '@/types/api'

/**
 * Routes server-side validation errors onto the fields they belong to.
 *
 * DRF answers a rejected form with `{ "email": ["Already registered."] }`. Left
 * alone that becomes a banner floating above the form saying "email: already
 * registered", which makes the user hunt for the field. This puts the message
 * under the input instead. (CLAUDE.md §63)
 *
 * Returns whether *every* returned error found a home. When it returns false
 * the caller must still show the form-level message, because at least one
 * error would otherwise be invisible.
 */

/** `confirm_password` → `confirmPassword`. DRF is snake_case; forms are not. */
function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}

export function applyFieldErrors<TValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TValues>,
  /** Field names this form owns. Anything else is left to the caller. */
  fields: readonly Path<TValues>[],
): boolean {
  if (!isApiError(error) || !error.fieldErrors) return false

  const entries = Object.entries(error.fieldErrors)
  if (entries.length === 0) return false

  let allHandled = true

  for (const [rawField, messages] of entries) {
    const field = toCamelCase(rawField) as Path<TValues>
    const message = messages[0]

    if (!message || !fields.includes(field)) {
      allHandled = false
      continue
    }

    setError(field, { type: 'server', message })
  }

  return allHandled
}
