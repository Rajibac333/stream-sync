import { api } from '@/api/client'
import { toTask, type TaskDto } from '@/api/tasks'
import type {
  AiActionItem,
  AiActionItemsResult,
  AiAnswer,
  AiRewriteRequest,
  AiRewriteResult,
  AiSummary,
} from '@/types/ai'
import { AiAssigneeSource } from '@/types/ai'
import type { AiDocumentContext } from '@/types/ai'
import type { Task, TaskPriority } from '@/types/task'

/**
 * AI service. (CLAUDE.md §9, §50, §51, §80)
 *
 * The only module in the frontend that knows how to reach an AI feature, and it
 * reaches Django — never a provider.
 *
 *   React → Django → AI service → provider          ✅
 *   React → provider                                 ❌
 *
 * The second is not a style preference. A provider call from the browser needs
 * a provider key in the browser, and a key in the browser is a key in the hands
 * of whoever opens devtools. There is no VITE_ variable that fixes this, which
 * is why none is referenced here. (§66, §79)
 *
 * Components never import this. They go through the hooks in
 * useAiAssistant.ts, which own the request lifecycle and the cache. (§51)
 */

/* -----------------------------------------------------------------------------
 * Inputs
 *
 * No `actorId`. The server takes the user from the session, and a client that
 * can name the actor can name somebody else. These types used to carry one
 * because the mock had no session to read.
 * -------------------------------------------------------------------------- */

export interface AiOperationInput {
  context: AiDocumentContext
}

export interface AiAskInput extends AiOperationInput {
  question: string
}

export interface CreateTasksFromActionItemsInput extends AiOperationInput {
  projectId: string
  items: readonly AiActionItem[]
}

/* -----------------------------------------------------------------------------
 * Wire format
 *
 * snake_case in, camelCase out — the same boundary every other service module
 * draws, so Django's conventions stop at src/api.
 * -------------------------------------------------------------------------- */

interface SummaryDto {
  summary: string
  key_points: string[]
  decisions: string[]
  engine: string
  generated_at: string
}

interface ActionItemDto {
  id: string
  title: string
  assignee_id: string | null
  assignee_name: string | null
  assignee_source: AiAssigneeSource
  due_date: string | null
  priority: TaskPriority
  source_quote: string
  source_section: string | null
}

interface ActionItemsDto {
  items: ActionItemDto[]
  engine: string
  generated_at: string
}

interface RewriteDto {
  text: string
  note: string
  changed: boolean
  engine: string
  generated_at: string
}

interface AnswerDto {
  answer: string
  citations: { quote: string; section: string | null }[]
  grounded: boolean
  engine: string
  generated_at: string
}

function toActionItem(dto: ActionItemDto): AiActionItem {
  return {
    id: dto.id,
    title: dto.title,
    assigneeId: dto.assignee_id,
    assigneeName: dto.assignee_name,
    assigneeSource: dto.assignee_source ?? AiAssigneeSource.Suggested,
    dueDate: dto.due_date,
    priority: dto.priority,
    sourceQuote: dto.source_quote,
    sourceSection: dto.source_section,
  }
}

/**
 * Body shared by every document-scoped call.
 *
 * `actor_id` is deliberately absent: the live API takes the user from the
 * session, and a client that can name the actor can name somebody else.
 */
function documentBody(input: AiOperationInput) {
  return {
    document_id: input.context.documentId,
    workspace_id: input.context.workspaceId,
    /* The unsaved editor body. Django may prefer its own copy; sending it means
       the assistant can answer about what is actually on screen. */
    content: input.context.content,
  }
}

export const aiApi = {
  /** POST /api/ai/summarize/ (§48) */
  async summarize(input: AiOperationInput): Promise<AiSummary> {
    const dto = await api.post<SummaryDto>('/ai/summarize/', documentBody(input))
    return {
      summary: dto.summary,
      keyPoints: dto.key_points,
      decisions: dto.decisions,
      engine: dto.engine,
      generatedAt: dto.generated_at,
    }
  },

  /** POST /api/ai/action-items/ (§49) */
  async actionItems(input: AiOperationInput): Promise<AiActionItemsResult> {
    const dto = await api.post<ActionItemsDto>('/ai/action-items/', documentBody(input))
    return {
      items: dto.items.map(toActionItem),
      engine: dto.engine,
      generatedAt: dto.generated_at,
    }
  },

  /** POST /api/ai/improve/ — clarity, length and tone all land here. (§47) */
  async rewrite(request: AiRewriteRequest): Promise<AiRewriteResult> {
    const dto = await api.post<RewriteDto>('/ai/improve/', {
      document_id: request.context.documentId,
      // Plain text, never HTML: what comes back is inserted into the document,
      // and a round trip that can return markup is a round trip that can
      // return markup somebody else wrote.
      text: request.text,
      mode: request.mode,
      tone: request.tone ?? null,
    })

    return {
      text: dto.text,
      note: dto.note,
      changed: dto.changed,
      mode: request.mode,
      tone: request.tone ?? null,
      engine: dto.engine,
      generatedAt: dto.generated_at,
    }
  },

  /** POST /api/ai/ask/ — scoped to one document, by design. (§47) */
  async ask(input: AiAskInput): Promise<AiAnswer> {
    const dto = await api.post<AnswerDto>('/ai/ask/', {
      ...documentBody(input),
      question: input.question,
    })

    return {
      answer: dto.answer,
      citations: dto.citations,
      grounded: dto.grounded,
      engine: dto.engine,
      generatedAt: dto.generated_at,
    }
  },

  /**
   * POST /api/ai/action-items/tasks/ (§49)
   *
   * One request for the whole batch. The client sends the items *after* the
   * user has edited them, so what gets created is what was on screen — the
   * server does not re-run extraction and quietly create something else.
   */
  async createTasksFromActionItems(input: CreateTasksFromActionItemsInput): Promise<Task[]> {
    // The response is a list of ordinary tasks — the same wire shape the task
    // endpoints return — so it goes through the same mapper rather than being
    // cast to `Task[]` and quietly handing every consumer snake_case keys.
    const created = await api.post<TaskDto[]>('/ai/action-items/tasks/', {
      document_id: input.context.documentId,
      workspace_id: input.context.workspaceId,
      project_id: input.projectId,
      items: input.items.map((item) => ({
        title: item.title,
        assignee_id: item.assigneeId,
        due_date: item.dueDate,
        priority: item.priority,
        source_quote: item.sourceQuote,
      })),
    })

    return created.map(toTask)
  },
}
