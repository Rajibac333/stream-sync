import { useEffect, useState } from 'react'

/**
 * Trails a rapidly-changing value, settling only once it stops moving.
 *
 * Used by the command menu so typing "payment" issues one search instead of
 * seven. The *input* stays fully controlled and responsive — only the value
 * that triggers work is delayed. (CLAUDE.md §64)
 */
export function useDebouncedValue<T>(value: T, delayMs = 180): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    // Clearing an empty query must be instant: waiting to *stop* showing
    // results makes the menu feel stuck.
    if (typeof value === 'string' && value.trim() === '') {
      setDebounced(value)
      return
    }

    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
