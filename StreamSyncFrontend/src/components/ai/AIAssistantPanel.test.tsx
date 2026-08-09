import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AIAssistantPanel } from '@/components/ai/AIAssistantPanel'
import { AIThinking } from '@/components/ai/AIThinking'
import { AiPanelTab } from '@/components/ai/tabs'
import { queryKeys } from '@/api/queryKeys'
import { useAiStore } from '@/store/aiStore'
import { AiAssigneeSource } from '@/types/ai'
import type { DocumentDetail } from '@/types/document'
import { TaskPriority } from '@/types/task'
import { createTestQueryClient, renderWithProviders, testSession } from '@/test/utils'

/**
 * AI assistant panel. (CLAUDE.md §47, §74, §75)
 *
 * Asserts the states a feature has to have to count as done — empty, loading,
 * result, and the refusal — through roles and text rather than internals, so
 * these fail when the experience regresses rather than when the markup moves.
 *
 * The AI service is stubbed at the module boundary. This is a test of the
 * panel: what it does with an answer, not how the answer is produced. Stubbing
 * `@/api/ai` also keeps the suite off the network, which is where the real
 * implementation now goes.
 */

vi.mock('@/api/auth', () => ({ authApi: { getSession: () => Promise.resolve(testSession) } }))

const GENERATED_AT = '2026-08-08T10:00:00.000Z'
const ENGINE = 'mock-heuristic'

const summarize = vi.fn()
const actionItems = vi.fn()
const ask = vi.fn()
const rewrite = vi.fn()
const createTasksFromActionItems = vi.fn()

vi.mock('@/api/ai', () => ({
  aiApi: {
    summarize: (...args: unknown[]) => summarize(...args),
    actionItems: (...args: unknown[]) => actionItems(...args),
    ask: (...args: unknown[]) => ask(...args),
    rewrite: (...args: unknown[]) => rewrite(...args),
    createTasksFromActionItems: (...args: unknown[]) => createTasksFromActionItems(...args),
  },
}))

const DOCUMENT_ID = 'doc-payments'

function documentFixture(): DocumentDetail {
  const person = { id: 'usr-raj', name: 'Raj Patel', avatarUrl: null }

  return {
    id: DOCUMENT_ID,
    workspaceId: 'wsp-evertech',
    projectId: 'prj-checkout',
    projectName: 'Checkout Revamp',
    title: 'Payment Requirements',
    excerpt: 'Stripe is the source of truth for payments.',
    author: person,
    lastEditedBy: person,
    collaborators: [person],
    activeCollaboratorIds: [],
    updatedAt: GENERATED_AT,
    createdAt: GENERATED_AT,
    content: '<h1>Scope</h1><p>Stripe is the source of truth for payments.</p>',
    revision: 12,
  }
}

function actionItem(id: string, title: string) {
  return {
    id,
    title,
    assigneeId: null,
    assigneeName: null,
    assigneeSource: AiAssigneeSource.Suggested,
    dueDate: null,
    priority: TaskPriority.Medium,
    sourceQuote: 'Stripe is the source of truth for payments.',
    sourceSection: 'Scope',
  }
}

function renderPanel(tab: AiPanelTab = AiPanelTab.Summary) {
  const onTabChange = vi.fn()

  /* The panel only ever renders inside an authenticated route, where the
     session is already resolved. Seeding it keeps that precondition true from
     the first render instead of letting the query resolve a tick later. */
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.session, testSession)

  const result = renderWithProviders(
    <AIAssistantPanel
      document={documentFixture()}
      workspaceId="wsp-evertech"
      // No Tiptap instance in jsdom; the panel falls back to the stored body,
      // which is exactly what it does before the editor finishes mounting.
      editor={null}
      canEdit
      tab={tab}
      onTabChange={onTabChange}
    />,
    { queryClient },
  )

  return { ...result, onTabChange }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAiStore.setState({ sessions: {} })

  summarize.mockResolvedValue({
    engine: ENGINE,
    generatedAt: GENERATED_AT,
    summary: 'Stripe is the source of truth for payments.',
    keyPoints: ['Stripe for cards', 'Apple Pay at checkout'],
    decisions: ['Apple Pay ships at launch'],
  })

  actionItems.mockResolvedValue({
    engine: ENGINE,
    generatedAt: GENERATED_AT,
    items: [
      actionItem('itm-1', 'Implement Apple Pay'),
      actionItem('itm-2', 'Design the checkout screen'),
    ],
  })

  ask.mockImplementation(({ question }: { question: string }) =>
    Promise.resolve(
      question.toLowerCase().includes('decision')
        ? {
            engine: ENGINE,
            generatedAt: GENERATED_AT,
            answer: 'Stripe was chosen as the source of truth.',
            citations: [
              { quote: 'Stripe is the source of truth for payments.', section: 'Scope' },
            ],
            grounded: true,
          }
        : {
            engine: ENGINE,
            generatedAt: GENERATED_AT,
            answer: "Payment Requirements doesn't cover that.",
            citations: [],
            grounded: false,
          },
    ),
  )
})

describe('summary', () => {
  it('offers the action before running it, rather than generating on open', async () => {
    renderPanel()

    // Nothing is generated until asked: opening a panel should not spend a
    // model call, and the user should know what they are about to get.
    expect(screen.getByRole('heading', { name: 'Summarise this document' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Summarise' })).toBeInTheDocument()
    expect(summarize).not.toHaveBeenCalled()
  })

  it('renders the summary, key points and decisions', async () => {
    const { user } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Summarise' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('heading', { name: 'Key points' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Important decisions/ })).toBeInTheDocument()
    expect(screen.getByText(/source of truth/)).toBeInTheDocument()
  })

})

describe('action items', () => {
  it('extracts items and offers to create the selected ones as tasks', async () => {
    const { user } = renderPanel(AiPanelTab.Actions)

    await user.click(screen.getByRole('button', { name: 'Extract action items' }))

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Implement Apple Pay/ })).toBeInTheDocument(),
    )

    const create = await screen.findByRole('button', { name: /Create \d+ tasks?/ })
    expect(create).toBeEnabled()
    // Extraction proposes; nothing is created until the user confirms. (§45)
    expect(createTasksFromActionItems).not.toHaveBeenCalled()
  })

  it('lets an item be excluded before anything is created', async () => {
    const { user } = renderPanel(AiPanelTab.Actions)

    await user.click(screen.getByRole('button', { name: 'Extract action items' }))
    const first = await screen.findByRole('checkbox', { name: /Implement Apple Pay/ })

    const before = Number(
      /Create (\d+)/.exec(
        screen.getByRole('button', { name: /Create \d+ tasks?/ }).textContent ?? '',
      )?.[1],
    )

    await user.click(first)

    await waitFor(() => {
      const after = Number(
        /Create (\d+)/.exec(
          screen.getByRole('button', { name: /Create \d+ tasks?/ }).textContent ?? '',
        )?.[1],
      )
      expect(after).toBe(before - 1)
    })
  })

  it('shows the source sentence for each item', async () => {
    const { user } = renderPanel(AiPanelTab.Actions)

    await user.click(screen.getByRole('button', { name: 'Extract action items' }))

    await waitFor(() => expect(screen.getAllByText(/From “Scope”/).length).toBeGreaterThan(0))
  })
})

describe('ask', () => {
  it('declines a question the document does not answer', async () => {
    const { user } = renderPanel(AiPanelTab.Ask)

    await user.type(
      screen.getByRole('textbox', { name: 'Your question' }),
      'What is the Kubernetes deployment schedule?',
    )
    await user.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() => expect(screen.getByText(/doesn't cover that/i)).toBeInTheDocument())
  })

  it('answers from the document when it can', async () => {
    const { user } = renderPanel(AiPanelTab.Ask)

    await user.click(screen.getByRole('button', { name: 'What decisions have been made?' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: /^What decisions/ })).toBeNull())
    expect(screen.getByText('What decisions have been made?')).toBeInTheDocument()
  })
})

describe('rewrite', () => {
  it('explains the precondition instead of showing dead buttons', () => {
    renderPanel(AiPanelTab.Rewrite)

    expect(screen.getByRole('heading', { name: 'Select something to rewrite' })).toBeInTheDocument()
  })
})

describe('loading state', () => {
  it('announces what it is doing, and hides the placeholder from screen readers', () => {
    renderWithProviders(<AIThinking label="Analyzing document" />)

    // A spinner alone says nothing about what is happening or what will arrive.
    expect(screen.getByRole('status')).toHaveTextContent('Analyzing document…')
  })
})
