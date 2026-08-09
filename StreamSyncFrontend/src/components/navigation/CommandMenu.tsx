import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  CornerDownLeft,
  FilePlus,
  FileText,
  FolderKanban,
  FolderPlus,
  ListChecks,
  Search,
  SquarePen,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import { Avatar } from '@/components/ui/Avatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { primaryNavigation, secondaryNavigation } from '@/constants/navigation'
import { useDismiss } from '@/hooks/useDismiss'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useLockBodyScroll } from '@/hooks/useLockBodyScroll'
import { useSearch } from '@/hooks/useSearch'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { toast } from '@/store/toastStore'
import { useUiStore, type CreateDialogState } from '@/store/uiStore'
import { SEARCH_TYPE_LABELS, SearchResultType, type SearchResult } from '@/types/search'
import { isApiError } from '@/types/api'
import { cn } from '@/utils/cn'

/**
 * Command menu — ⌘K / Ctrl+K. (CLAUDE.md §30)
 *
 * Implements the ARIA combobox pattern, not a list of buttons. The distinction
 * is what makes it usable with a screen reader:
 *
 *   • focus never leaves the text input, so typing always works
 *   • the highlighted option is communicated with `aria-activedescendant`
 *   • options are `role="option"` inside a `role="listbox"`, grouped and
 *     labelled by type
 *
 * If options were focusable buttons instead, every arrow key would move real
 * focus out of the input and the user would have to tab back to keep typing.
 *
 * The dialog itself is modal: focus trapped, Escape to close, body scroll
 * locked, focus returned to whatever opened it.
 */

interface CommandItem {
  id: string
  label: string
  subtitle: string | null
  /** Rendered leading; people get an avatar instead. */
  icon: LucideIcon
  avatar?: { name: string; id: string } | undefined
  onSelect: () => void
  /** Extra text matched against the query for locally-filtered items. */
  keywords?: string
}

interface CommandGroup {
  id: string
  label: string
  items: CommandItem[]
}

const RESULT_ICONS: Record<SearchResultType, LucideIcon> = {
  [SearchResultType.Project]: FolderKanban,
  [SearchResultType.Document]: FileText,
  [SearchResultType.Task]: ListChecks,
  [SearchResultType.Person]: Users,
}

/** Case-insensitive substring match across label, subtitle and keywords. */
function matches(item: CommandItem, query: string): boolean {
  if (query === '') return true
  const haystack = `${item.label} ${item.subtitle ?? ''} ${item.keywords ?? ''}`.toLowerCase()
  return haystack.includes(query)
}

export function CommandMenu() {
  const open = useUiStore((state) => state.commandMenuOpen)
  const setOpen = useUiStore((state) => state.setCommandMenuOpen)
  const openCreateDialog = useUiStore((state) => state.openCreateDialog)

  const navigate = useNavigate()
  const { workspace } = useActiveWorkspace()

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const reduceMotion = useReducedMotion()

  const close = useCallback(() => setOpen(false), [setOpen])

  useFocusTrap(panelRef, open, { initialFocusRef: inputRef })
  useLockBodyScroll(open)
  useDismiss(panelRef, close, { enabled: open })

  // A fresh menu every time. Reopening onto the previous query would be a
  // surprise — ⌘K is muscle memory for "start something new".
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
    }
  }, [open])

  const normalizedQuery = query.trim().toLowerCase()
  const { data: results, isFetching, isError, error } = useSearch(query, open)

  /* ---------------------------------------------------------------------
     Item sources
     --------------------------------------------------------------------- */

  const actionItems = useMemo<CommandItem[]>(() => {
    /* Three of the four actions §30 requires open the real dialog. Member
       invitations need a workspace permission model that is not built, and say
       so rather than being a dead control. (Rule 10) */
    const create = (dialog: CreateDialogState) => () => {
      close()
      openCreateDialog(dialog)
    }

    const notBuilt = (feature: string) => () => {
      toast.show({
        title: `${feature} aren’t built yet`,
        description: 'The command menu is wired and ready for them.',
      })
      close()
    }

    return [
      {
        id: 'action-project',
        label: 'Create project',
        subtitle: null,
        icon: FolderPlus,
        keywords: 'new add project',
        onSelect: create({ kind: 'project' }),
      },
      {
        id: 'action-document',
        label: 'Create document',
        subtitle: null,
        icon: FilePlus,
        keywords: 'new add doc write',
        onSelect: create({ kind: 'document' }),
      },
      {
        id: 'action-task',
        label: 'Create task',
        subtitle: null,
        icon: SquarePen,
        keywords: 'new add todo issue',
        onSelect: create({ kind: 'task' }),
      },
      {
        id: 'action-invite',
        label: 'Invite member',
        subtitle: null,
        icon: UserPlus,
        keywords: 'new add people teammate invite',
        onSelect: notBuilt('Member invitations'),
      },
    ]
  }, [close, openCreateDialog])

  const navigationItems = useMemo<CommandItem[]>(() => {
    const workspaceId = workspace?.id
    return [...primaryNavigation, ...secondaryNavigation]
      .filter((item) => !item.requiresWorkspace || workspaceId !== undefined)
      .map((item) => ({
        id: `nav-${item.id}`,
        label: item.label,
        subtitle: null,
        icon: item.icon,
        keywords: 'go to open navigate',
        onSelect: () => {
          navigate(item.to(workspaceId ?? ''))
          close()
        },
      }))
  }, [workspace, navigate, close])

  const resultItems = useMemo<CommandItem[]>(() => {
    if (!results) return []

    return results.map((result: SearchResult) => ({
      id: `result-${result.type}-${result.id}`,
      label: result.title,
      subtitle: result.subtitle,
      icon: RESULT_ICONS[result.type],
      avatar:
        result.type === SearchResultType.Person
          ? { name: result.title, id: result.id }
          : undefined,
      onSelect: () => {
        if (result.href) navigate(result.href)
        close()
      },
    }))
  }, [results, navigate, close])

  /* ---------------------------------------------------------------------
     Grouping
     Remote results lead when there is a query: someone who typed a document
     name wants the document, not the "Create document" action.
     --------------------------------------------------------------------- */

  const groups = useMemo<CommandGroup[]>(() => {
    const filteredActions = actionItems.filter((item) => matches(item, normalizedQuery))
    const filteredNavigation = navigationItems.filter((item) => matches(item, normalizedQuery))

    const resultGroups: CommandGroup[] =
      normalizedQuery === ''
        ? []
        : (Object.values(SearchResultType) as SearchResultType[])
            .map((type) => ({
              id: `results-${type}`,
              label: SEARCH_TYPE_LABELS[type],
              items: resultItems.filter((item) => item.id.startsWith(`result-${type}-`)),
            }))
            .filter((group) => group.items.length > 0)

    return [
      ...resultGroups,
      ...(filteredActions.length > 0
        ? [{ id: 'actions', label: 'Actions', items: filteredActions }]
        : []),
      ...(filteredNavigation.length > 0
        ? [{ id: 'navigation', label: 'Go to', items: filteredNavigation }]
        : []),
    ]
  }, [normalizedQuery, actionItems, navigationItems, resultItems])

  // Flat view for keyboard traversal — the visual grouping is presentation.
  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups])

  /* A new query is a new list, so the highlight returns to the top — holding
     position would leave it on whatever happens to occupy that index. */
  useEffect(() => {
    setActiveIndex(0)
  }, [normalizedQuery])

  /* Length changes are *not* treated as a new list. Items arrive
     asynchronously — workspaces resolving grows the "Go to" group, a slow
     search grows the result groups — and resetting on every such change would
     snap the highlight back to the top under someone mid-way through arrowing.
     The index is only clamped, and only when it would otherwise dangle past
     the end of a list that shrank. */
  useEffect(() => {
    setActiveIndex((current) => (current < flatItems.length ? current : 0))
  }, [flatItems.length])

  const activeItem = flatItems[activeIndex]
  const activeOptionId = activeItem ? `${baseId}-option-${activeIndex}` : undefined

  // Keep the highlight visible when arrowing past the fold.
  useEffect(() => {
    if (!activeOptionId) return
    listRef.current
      ?.querySelector(`[id="${activeOptionId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionId])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (flatItems.length === 0) return

    const move = (delta: number) => {
      event.preventDefault()
      setActiveIndex((current) => (current + delta + flatItems.length) % flatItems.length)
    }

    switch (event.key) {
      case 'ArrowDown':
        move(1)
        break
      case 'ArrowUp':
        move(-1)
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(flatItems.length - 1)
        break
      case 'Enter':
        event.preventDefault()
        activeItem?.onSelect()
        break
      default:
        break
    }
  }

  const showEmpty = !isFetching && normalizedQuery !== '' && flatItems.length === 0

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6">
          <motion.div
            className="absolute inset-0 bg-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.14 }}
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Command menu"
            className={cn(
              'relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-xl',
              'border border-border bg-surface-raised shadow-xl',
              // Sits high rather than centred: the list grows downward, and a
              // vertically-centred palette jumps as results arrive.
              'mt-[8vh] max-h-[min(32rem,75dvh)]',
            )}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -4 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
          >
            {/* ------------------------------------------------------------
                Input — the combobox
               ------------------------------------------------------------ */}
            <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-3.5">
              <Search className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />

              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                aria-autocomplete="list"
                aria-label="Search projects, documents, tasks and people"
                placeholder="Search or jump to…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                spellCheck={false}
                className="h-12 w-full bg-transparent text-body-lg text-foreground outline-none placeholder:text-foreground-subtle"
              />

              {isFetching && normalizedQuery !== '' ? (
                <span className="shrink-0 text-caption text-foreground-subtle" role="status">
                  Searching…
                </span>
              ) : null}
            </div>

            {/* ------------------------------------------------------------
                Results
               ------------------------------------------------------------ */}
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
              {isError ? (
                <p role="alert" className="px-3 py-8 text-center text-body text-foreground-muted">
                  {isApiError(error) ? error.message : 'Search is unavailable right now.'}
                </p>
              ) : isFetching && flatItems.length === 0 ? (
                <div className="flex flex-col gap-1 p-1" aria-busy="true">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : showEmpty ? (
                <div className="px-3 py-10 text-center">
                  <p className="text-body text-foreground">No results for “{query.trim()}”</p>
                  <p className="mt-1 text-small text-foreground-muted">
                    Try a different term, or use an action above.
                  </p>
                </div>
              ) : (
                <div role="listbox" id={listboxId} aria-label="Results">
                  {groups.map((group) => (
                    <div
                      key={group.id}
                      role="group"
                      aria-labelledby={`${baseId}-group-${group.id}`}
                      className="mb-1 last:mb-0"
                    >
                      <div
                        id={`${baseId}-group-${group.id}`}
                        className="px-2 py-1.5 text-caption font-medium text-foreground-subtle"
                      >
                        {group.label}
                      </div>

                      {group.items.map((item) => {
                        const index = flatItems.indexOf(item)
                        const active = index === activeIndex
                        const Icon = item.icon

                        return (
                          <div
                            key={item.id}
                            id={`${baseId}-option-${index}`}
                            role="option"
                            aria-selected={active}
                            // Pointer users get the same highlight the keyboard
                            // drives, so the two never disagree about what
                            // Enter will do.
                            onMouseMove={() => setActiveIndex(index)}
                            onClick={item.onSelect}
                            className={cn(
                              'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-body',
                              active ? 'bg-surface-hover text-foreground' : 'text-foreground-muted',
                            )}
                          >
                            {item.avatar ? (
                              <Avatar
                                size="sm"
                                name={item.avatar.name}
                                userId={item.avatar.id}
                                className="shrink-0"
                              />
                            ) : (
                              <Icon
                                className="size-4 shrink-0 text-foreground-subtle"
                                aria-hidden="true"
                              />
                            )}

                            <span className="min-w-0 flex-1 truncate">
                              <span className={cn(active && 'text-foreground')}>{item.label}</span>
                              {item.subtitle ? (
                                <span className="ml-2 text-caption text-foreground-subtle">
                                  {item.subtitle}
                                </span>
                              ) : null}
                            </span>

                            {active ? (
                              <CornerDownLeft
                                className="size-3.5 shrink-0 text-foreground-subtle"
                                aria-hidden="true"
                              />
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ------------------------------------------------------------
                Legend — teaches the keyboard model in place
               ------------------------------------------------------------ */}
            <div
              className="hidden shrink-0 items-center gap-4 border-t border-border px-3.5 py-2 text-caption text-foreground-subtle sm:flex"
              aria-hidden="true"
            >
              <span className="flex items-center gap-1.5">
                <kbd className="rounded-xs border border-border px-1 font-sans">↑</kbd>
                <kbd className="rounded-xs border border-border px-1 font-sans">↓</kbd>
                to navigate
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="rounded-xs border border-border px-1 font-sans">↵</kbd>
                to select
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="rounded-xs border border-border px-1 font-sans">Esc</kbd>
                to close
              </span>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
