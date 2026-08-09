import { api } from '@/api/client'
import type { SearchResult, SearchResultType } from '@/types/search'

/**
 * Global search. (CLAUDE.md §46)
 *
 * Takes an AbortSignal because the command menu fires a request per keystroke
 * (debounced): without cancellation, a slow response to "pa" can land after
 * the response to "payment" and replace correct results with stale ones.
 */

interface SearchResultDto {
  id: string
  type: SearchResultType
  title: string
  subtitle: string | null
  href: string | null
  score: number
}

export const searchApi = {
  async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    return api.get<SearchResultDto[]>('/search/', {
      params: { q: query },
      ...(signal ? { signal } : {}),
    })
  },
}
