import { api, notImplemented } from '@/api/client'
import { workspacesApi } from '@/api/workspaces'
import type { Paginated } from '@/types/api'
import type {
  DocumentCollaborator,
  DocumentDetail,
  DocumentShareEntry,
  DocumentSummary,
  DocumentVersion,
} from '@/types/document'
import type { WorkspaceRole } from '@/types/auth'
import { MemberStatus } from '@/types/workspace'

/** Document service. (CLAUDE.md §33, §51) */

interface CollaboratorDto {
  id: string
  name: string
  avatar_url: string | null
}

interface DocumentDto {
  id: string
  workspace_id: string
  project_id: string | null
  project_name: string | null
  title: string
  excerpt: string | null
  author: CollaboratorDto
  last_edited_by: CollaboratorDto
  collaborators: CollaboratorDto[]
  active_collaborator_ids: string[]
  updated_at: string
  created_at: string
}

function toCollaborator(dto: CollaboratorDto): DocumentCollaborator {
  return { id: dto.id, name: dto.name, avatarUrl: dto.avatar_url }
}

function toDocument(dto: DocumentDto): DocumentSummary {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    projectId: dto.project_id,
    projectName: dto.project_name,
    title: dto.title,
    excerpt: dto.excerpt,
    author: toCollaborator(dto.author),
    lastEditedBy: toCollaborator(dto.last_edited_by),
    collaborators: dto.collaborators.map(toCollaborator),
    activeCollaboratorIds: dto.active_collaborator_ids,
    updatedAt: dto.updated_at,
    createdAt: dto.created_at,
  }
}

interface DocumentVersionDto {
  id: string
  number: number
  author: CollaboratorDto
  summary: string
  is_current: boolean
  created_at: string
}

function toVersion(dto: DocumentVersionDto): DocumentVersion {
  return {
    id: dto.id,
    number: dto.number,
    author: toCollaborator(dto.author),
    summary: dto.summary,
    isCurrent: dto.is_current,
    createdAt: dto.created_at,
  }
}

/** See CreateProjectPayload for why `actorId` never reaches the live API. */
export interface CreateDocumentPayload {
  workspaceId: string
  title: string
  projectId: string | null
  actorId: string
}

export const documentsApi = {
  async list(workspaceId: string): Promise<DocumentSummary[]> {
    const page = await api.get<Paginated<DocumentDto>>('/documents/', {
      params: { workspace: workspaceId },
    })
    return page.results.map(toDocument)
  },

  /** Full record including the body. (§34) */
  async get(documentId: string): Promise<DocumentDetail> {
    const dto = await api.get<DocumentDto & { content: string; revision: number }>(
      `/documents/${documentId}/`,
    )
    return { ...toDocument(dto), content: dto.content, revision: dto.revision }
  },

  /**
   * Saves the body over REST.
   *
   * The WebSocket is the primary path for edits; this is the fallback for a
   * client with no socket, and the explicit "save now" action. Both write the
   * same field, and the server's revision counter is what reconciles them.
   */
  async saveContent(documentId: string, content: string): Promise<DocumentDetail> {
    const dto = await api.patch<DocumentDto & { content: string; revision: number }>(
      `/documents/${documentId}/`,
      { content },
    )
    return { ...toDocument(dto), content: dto.content, revision: dto.revision }
  },

  async versions(documentId: string): Promise<DocumentVersion[]> {
    // Paginated and snake_case, like every other list the backend serves. The
    // page size (25) comfortably exceeds what the history panel shows, so the
    // first page is the whole answer in practice; when it is not, older
    // versions are reachable by paging, not lost.
    const page = await api.get<Paginated<DocumentVersionDto>>(
      `/documents/${documentId}/versions/`,
    )
    return page.results.map(toVersion)
  },

  /** Restores a version as a new forward write, never by rewriting history. (§41) */
  async restoreVersion(documentId: string, versionId: string): Promise<DocumentDetail> {
    const dto = await api.post<DocumentDto & { content: string; revision: number }>(
      `/documents/${documentId}/versions/${versionId}/restore/`,
    )
    return { ...toDocument(dto), content: dto.content, revision: dto.revision }
  },

  /**
   * Who can open this document.
   *
   * There is no per-document ACL in the backend, and this does not pretend
   * otherwise: access to a document *is* membership of its workspace, so the
   * honest answer to "who has access?" is the workspace roster with each
   * person's workspace role. Reading it that way keeps the dialog truthful
   * rather than inventing a sharing model the server does not implement.
   */
  async shares(documentId: string): Promise<DocumentShareEntry[]> {
    const document = await api.get<DocumentDto>(`/documents/${documentId}/`)
    const members = await workspacesApi.members(document.workspace_id)

    return members
      .filter((member) => member.status === MemberStatus.Active)
      .map((member) => ({
        id: member.id,
        user: {
          id: member.user.id,
          name: member.user.name,
          avatarUrl: member.user.avatarUrl,
          email: member.user.email,
        },
        role: member.role,
      }))
  },

  /**
   * Not available against the live API.
   *
   * Since access is workspace membership, the only thing this *could* do is
   * change somebody's role across the entire workspace — a far wider action
   * than "change their role on this document", and not what the person
   * clicking in a share dialog is asking for. Refusing with an explanation
   * beats quietly doing the bigger thing. Roles are changed on the members
   * screen, which is scoped to that decision.
   */
  async updateShareRole(
    _documentId: string,
    _shareId: string,
    _role: WorkspaceRole,
  ): Promise<DocumentShareEntry[]> {
    throw notImplemented(
      'Per-document roles are not available. Access follows workspace membership — ' +
        'change this person’s role on the workspace members screen.',
    )
  },

  async create(payload: CreateDocumentPayload): Promise<DocumentSummary> {
    const dto = await api.post<DocumentDto>('/documents/', {
      workspace_id: payload.workspaceId,
      title: payload.title,
      project_id: payload.projectId,
    })
    return toDocument(dto)
  },
}
