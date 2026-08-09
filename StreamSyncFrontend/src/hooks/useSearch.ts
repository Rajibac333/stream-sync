import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { queryKeys } from '@/api/queryKeys'
import { searchApi } from '@/api/search'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { SearchResult } from '@/types/search'

/**
 * Global search, debounced and cancellable. (CLAUDE.md §30, §46)
 *
 * Two behaviours that make the command menu feel instant rather than laggy:
 *
 *   `placeholderData: keep`  the previous results stay on screen while the next
 *                            query runs, so the list doesn't blank out between
 *                            keystrokes
 *   `signal`                 TanStack passes an AbortSignal straight through to
 *                            the request, so superseded queries are cancelled
 *                            and can never land out of order
 *
 * Results are cached per term, which makes backspacing feel free.
 */
export function useSearch(query: string, enabled = true): UseQueryResult<SearchResult[]> {
  const debouncedQuery = useDebouncedValue(query, 180)
  const trimmed = debouncedQuery.trim()

  return useQuery({
    queryKey: queryKeys.search.query(trimmed),
    queryFn: ({ signal }) => searchApi.search(trimmed, signal),
    enabled: enabled && trimmed.length > 0,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  })
}
