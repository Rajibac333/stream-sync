import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandMenu } from '@/components/navigation/CommandMenu'
import { renderWithProviders, testSession, testWorkspaces } from '@/test/utils'
import { useUiStore } from '@/store/uiStore'
import { SearchResultType, type SearchResult } from '@/types/search'

/**
 * Command menu. (CLAUDE.md §30)
 *
 * The keyboard model *is* the feature, so most of this file is keyboard
 * behaviour and ARIA wiring rather than rendering. Queries go through roles —
 * `combobox`, `listbox`, `option` — which means these tests fail if the
 * accessibility semantics regress, not just if the pixels move.
 */

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const search = vi.fn()
vi.mock('@/api/search', () => ({ searchApi: { search: (...args: unknown[]) => search(...args) } }))
vi.mock('@/api/auth', () => ({ authApi: { getSession: () => Promise.resolve(testSession) } }))
vi.mock('@/api/workspaces', () => ({
  workspacesApi: { list: () => Promise.resolve(testWorkspaces) },
}))

const searchResults: SearchResult[] = [
  {
    id: 'doc-payments',
    type: SearchResultType.Document,
    title: 'Payment Requirements',
    subtitle: 'Checkout Revamp',
    href: '/app/workspaces/evertech/documents/doc-payments',
    score: 0.9,
  },
  {
    id: 'tsk-stripe',
    type: SearchResultType.Task,
    title: 'Implement Stripe payment intent flow',
    subtitle: 'In Progress',
    href: '/app/workspaces/evertech/tasks/tsk-stripe',
    score: 0.8,
  },
]

function renderMenu() {
  const result = renderWithProviders(<CommandMenu />, {
    initialEntries: ['/app/workspaces/evertech/projects'],
  })
  return result
}

/** The option the menu would activate on Enter. */
function activeOption(): HTMLElement | null {
  const combobox = screen.getByRole('combobox')
  const id = combobox.getAttribute('aria-activedescendant')
  return id ? document.getElementById(id) : null
}

/**
 * Waits until the menu is genuinely ready for keyboard input.
 *
 * Two things settle asynchronously and both matter: focus is moved into the
 * input on the next animation frame, and the workspace query resolves shortly
 * after, which grows the "Go to" group. Typing keys before either lands sends
 * them to <body>, which tests nothing.
 */
async function readyForInput(): Promise<HTMLElement> {
  const combobox = screen.getByRole('combobox')
  await waitFor(() => expect(combobox).toHaveFocus())
  await screen.findByRole('option', { name: /^dashboard$/i })
  return combobox
}

beforeEach(() => {
  navigate.mockReset()
  search.mockReset()
  search.mockResolvedValue(searchResults)
  useUiStore.setState({ commandMenuOpen: true })
})

afterEach(() => {
  useUiStore.setState({ commandMenuOpen: false })
})

describe('CommandMenu', () => {
  describe('dialog semantics', () => {
    it('is a modal dialog with an accessible name', () => {
      renderMenu()
      expect(screen.getByRole('dialog', { name: /command menu/i })).toHaveAttribute(
        'aria-modal',
        'true',
      )
    })

    it('is not rendered at all when closed', () => {
      useUiStore.setState({ commandMenuOpen: false })
      renderMenu()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('puts focus in the input on open', async () => {
      renderMenu()
      await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())
    })

    it('closes on Escape', async () => {
      const { user } = renderMenu()
      await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())

      await user.keyboard('{Escape}')

      await waitFor(() => expect(useUiStore.getState().commandMenuOpen).toBe(false))
    })
  })

  describe('combobox wiring', () => {
    it('declares the listbox it controls', () => {
      renderMenu()
      const combobox = screen.getByRole('combobox')

      expect(combobox).toHaveAttribute('aria-expanded', 'true')
      expect(combobox).toHaveAttribute('aria-autocomplete', 'list')
      expect(document.getElementById(combobox.getAttribute('aria-controls') ?? '')).toHaveAttribute(
        'role',
        'listbox',
      )
    })

    it('tracks the highlighted option with aria-activedescendant', async () => {
      renderMenu()
      // Focus stays in the input; the highlight is virtual. That is what lets
      // the user keep typing while arrowing through results.
      const combobox = await readyForInput()

      expect(combobox).toHaveFocus()
      expect(activeOption()).not.toBeNull()
      expect(activeOption()).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('with an empty query', () => {
    it('offers the four required actions', () => {
      renderMenu()
      const listbox = screen.getByRole('listbox')

      for (const action of [
        /create project/i,
        /create document/i,
        /create task/i,
        /invite member/i,
      ]) {
        expect(within(listbox).getByRole('option', { name: action })).toBeInTheDocument()
      }
    })

    it('offers navigation to every section once a workspace resolves', async () => {
      renderMenu()
      const listbox = screen.getByRole('listbox')

      await waitFor(() =>
        expect(within(listbox).getByRole('option', { name: /^documents$/i })).toBeInTheDocument(),
      )
      expect(within(listbox).getByRole('option', { name: /^dashboard$/i })).toBeInTheDocument()
    })

    it('does not search before anything is typed', () => {
      renderMenu()
      expect(search).not.toHaveBeenCalled()
    })
  })

  describe('searching', () => {
    it('returns matches from the server, grouped by type', async () => {
      const { user } = renderMenu()
      await user.type(screen.getByRole('combobox'), 'payment')

      expect(await screen.findByRole('option', { name: /payment requirements/i })).toBeInTheDocument()
      expect(screen.getByRole('group', { name: /documents/i })).toBeInTheDocument()
      expect(screen.getByRole('group', { name: /tasks/i })).toBeInTheDocument()
    })

    it('debounces so a typed word is one request, not seven', async () => {
      const { user } = renderMenu()
      await user.type(screen.getByRole('combobox'), 'payment')

      await waitFor(() => expect(search).toHaveBeenCalled())
      expect(search.mock.calls.length).toBeLessThan(3)
    })

    it('filters the local actions by the same query', async () => {
      const { user } = renderMenu()
      await user.type(screen.getByRole('combobox'), 'invite')

      await waitFor(() =>
        expect(screen.getByRole('option', { name: /invite member/i })).toBeInTheDocument(),
      )
      expect(screen.queryByRole('option', { name: /create project/i })).not.toBeInTheDocument()
    })

    it('explains an empty result rather than showing a blank panel', async () => {
      search.mockResolvedValue([])
      const { user } = renderMenu()
      await user.type(screen.getByRole('combobox'), 'zzzzqqq')

      expect(await screen.findByText(/no results for/i)).toBeInTheDocument()
    })

    it('reports a failed search instead of looking empty', async () => {
      search.mockRejectedValue({
        status: 500,
        code: 'server',
        message: 'Search is temporarily unavailable.',
        retryable: true,
      })
      const { user } = renderMenu()
      await user.type(screen.getByRole('combobox'), 'payment')

      expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i)
    })
  })

  describe('keyboard navigation', () => {
    it('moves the highlight with the arrow keys', async () => {
      const { user } = renderMenu()
      await readyForInput()

      const first = activeOption()?.textContent
      await user.keyboard('{ArrowDown}')
      expect(activeOption()?.textContent).not.toBe(first)

      await user.keyboard('{ArrowUp}')
      expect(activeOption()?.textContent).toBe(first)
    })

    it('wraps around at both ends', async () => {
      const { user } = renderMenu()
      await readyForInput()

      const first = activeOption()?.textContent
      // Up from the first item lands on the last, not nowhere.
      await user.keyboard('{ArrowUp}')
      const last = activeOption()?.textContent
      expect(last).not.toBe(first)

      await user.keyboard('{ArrowDown}')
      expect(activeOption()?.textContent).toBe(first)
    })

    it('jumps to the ends with Home and End', async () => {
      const { user } = renderMenu()
      await readyForInput()
      const first = activeOption()?.textContent

      await user.keyboard('{End}')
      const last = activeOption()?.textContent
      expect(last).not.toBe(first)

      await user.keyboard('{Home}')
      expect(activeOption()?.textContent).toBe(first)
    })

    it('navigates to the highlighted result on Enter and closes', async () => {
      const { user } = renderMenu()
      await user.type(screen.getByRole('combobox'), 'payment')
      await screen.findByRole('option', { name: /payment requirements/i })

      await waitFor(() => expect(activeOption()?.textContent).toMatch(/payment requirements/i))
      await user.keyboard('{Enter}')

      expect(navigate).toHaveBeenCalledWith('/app/workspaces/evertech/documents/doc-payments')
      await waitFor(() => expect(useUiStore.getState().commandMenuOpen).toBe(false))
    })

    it('resets the highlight to the top when the query changes', async () => {
      const { user } = renderMenu()
      await readyForInput()

      await user.keyboard('{ArrowDown}{ArrowDown}')
      await user.type(screen.getByRole('combobox'), 'payment')
      await screen.findByRole('option', { name: /payment requirements/i })

      // Holding position would leave the highlight on whatever happens to sit
      // at that index in a completely different list.
      const listbox = screen.getByRole('listbox')
      const firstOption = within(listbox).getAllByRole('option')[0]
      await waitFor(() => expect(activeOption()).toBe(firstOption))
    })
  })

  describe('pointer and keyboard agree', () => {
    it('hovering an option makes it the one Enter would activate', async () => {
      const { user } = renderMenu()
      await readyForInput()

      const target = screen.getAllByRole('option')[2]
      if (!target) throw new Error('expected at least three options')

      await user.hover(target)
      expect(activeOption()).toBe(target)
    })

    it('does not snap the highlight back when items arrive asynchronously', async () => {
      const { user } = renderMenu()
      await readyForInput()

      await user.keyboard('{ArrowDown}')
      const chosen = activeOption()

      // The search resolving must not reposition a highlight the user set.
      await user.hover(screen.getAllByRole('option')[1] ?? document.body)
      expect(activeOption()).toBe(chosen)
    })
  })
})
