import { FileText, Plus, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { DocumentRow, DocumentRowSkeleton } from '@/components/documents/DocumentRow'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { QueryState } from '@/components/ui/QueryState'
import { Select } from '@/components/ui/Select'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { useDocuments, useProjects } from '@/hooks/useWorkspaceContent'
import { useUiStore } from '@/store/uiStore'
import type { DocumentSummary } from '@/types/document'

/**
 * Document list. (CLAUDE.md §33)
 *
 * Search, filter and sort run on the client here because the whole list is
 * already in the cache and round-tripping for a substring match would make
 * typing feel laggy. That is a decision with a shelf life: when a workspace
 * holds thousands of documents this moves server-side, and the shape of the
 * change is the same one `useSearch` already uses for the command menu — a
 * debounced, cancellable query keyed by the search term.
 *
 * The input is debounced regardless, so filtering does not run on every
 * keystroke over a long list.
 */

const SORT_OPTIONS = [
  { value: 'recent', label: 'Last edited' },
  { value: 'created', label: 'Recently created' },
  { value: 'title', label: 'Title (A–Z)' },
] as const

type SortMode = (typeof SORT_OPTIONS)[number]['value']

function sortDocuments(documents: DocumentSummary[], mode: SortMode): DocumentSummary[] {
  const sorted = [...documents]

  switch (mode) {
    case 'title':
      // `localeCompare` rather than `<`, so accented titles sort correctly.
      return sorted.sort((a, b) => a.title.localeCompare(b.title))
    case 'created':
      return sorted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    case 'recent':
    default:
      return sorted.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }
}

export function DocumentsPage() {
  const { workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null

  const documentsQuery = useDocuments(workspaceId)
  const { data: projects } = useProjects(workspaceId)
  const openCreateDialog = useUiStore((state) => state.openCreateDialog)
  const startCreate = () => openCreateDialog({ kind: 'document' })

  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [sort, setSort] = useState<SortMode>('recent')

  const debouncedSearch = useDebouncedValue(search, 160)

  const projectOptions = useMemo(
    () => [
      { value: 'all', label: 'All projects' },
      { value: 'none', label: 'No project' },
      ...(projects ?? []).map((project) => ({ value: project.id, label: project.name })),
    ],
    [projects],
  )

  /* Derived once per input change, not once per call site. This used to be a
     memoised *function*, which meant the filter and the sort ran twice on every
     render — once to answer "is it empty?" and again to draw the list. */
  const results = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase()

    const filtered = (documentsQuery.data ?? []).filter((document) => {
      if (projectFilter === 'none' && document.projectId !== null) return false
      if (projectFilter !== 'all' && projectFilter !== 'none' && document.projectId !== projectFilter) {
        return false
      }
      if (term === '') return true

      // Title, excerpt and the person who last touched it — the three things
      // someone actually remembers about a document they are hunting for.
      return (
        document.title.toLowerCase().includes(term) ||
        (document.excerpt?.toLowerCase().includes(term) ?? false) ||
        document.lastEditedBy.name.toLowerCase().includes(term)
      )
    })

    return sortDocuments(filtered, sort)
  }, [documentsQuery.data, debouncedSearch, projectFilter, sort])

  const hasFilters = search.trim() !== '' || projectFilter !== 'all'

  const clearFilters = () => {
    setSearch('')
    setProjectFilter('all')
  }

  return (
    <div className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-h1 text-foreground">Documents</h1>
          <p className="mt-1 text-body text-foreground-muted">
            Everything your team is writing, most recently edited first.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={startCreate}
          leadingIcon={<Plus aria-hidden="true" />}
          disabled={!workspaceId}
        >
          New document
        </Button>
      </header>

      {/* A search-and-filter bar is a form, and saying so gives screen-reader
          users a region they can jump to. */}
      <search className="mt-5">
        <form
          role="search"
          aria-label="Filter documents"
          onSubmit={(event) => event.preventDefault()}
          className="flex flex-wrap items-end gap-3"
        >
          <Input
            label="Search documents"
            hideLabel
            type="search"
            placeholder="Search by title, content or author…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            leadingIcon={<Search aria-hidden="true" />}
            containerClassName="min-w-56 flex-1"
            {...(search !== ''
              ? {
                  trailingSlot: (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setSearch('')}
                      aria-label="Clear search"
                    >
                      <X aria-hidden="true" />
                    </Button>
                  ),
                }
              : {})}
          />

          <Select
            label="Project"
            hideLabel
            options={projectOptions}
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            containerClassName="w-44"
          />

          <Select
            label="Sort by"
            hideLabel
            options={SORT_OPTIONS.map((option) => ({ ...option }))}
            value={sort}
            onChange={(event) => setSort(event.target.value as SortMode)}
            containerClassName="w-40"
          />
        </form>
      </search>

      <div className="mt-4">
        <QueryState
          query={documentsQuery}
          isEmpty={() => results.length === 0}
          errorTitle="Couldn't load documents"
          loading={
            <ul className="rounded-lg border border-border bg-surface p-1.5" aria-busy="true">
              <span className="sr-only" role="status">
                Loading documents
              </span>
              <DocumentRowSkeleton />
              <DocumentRowSkeleton />
              <DocumentRowSkeleton />
              <DocumentRowSkeleton />
            </ul>
          }
          empty={
            hasFilters ? (
              <EmptyState
                icon={<Search />}
                title="No matching documents"
                description={
                  search.trim() !== ''
                    ? `Nothing matches "${search.trim()}".`
                    : 'Nothing matches the current filter.'
                }
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<FileText />}
                title="No documents yet"
                description="Create your first document and start collaborating."
                action={
                  <Button variant="primary" onClick={startCreate}>
                    Create document
                  </Button>
                }
              />
            )
          }
        >
          {() => (
            <>
              {/* Announced politely so a screen-reader user learns the result
                  count changed without the list itself being re-read. */}
              <p role="status" className="sr-only">
                {results.length} {results.length === 1 ? 'document' : 'documents'}
              </p>

              <ul className="rounded-lg border border-border bg-surface p-1.5">
                {results.map((document) => (
                  <DocumentRow key={document.id} document={document} />
                ))}
              </ul>
            </>
          )}
        </QueryState>
      </div>
    </div>
  )
}
