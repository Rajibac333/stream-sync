/**
 * Central query-key registry.
 *
 * Keys are built here rather than inline at call sites so that invalidation is
 * a refactorable operation. `queryClient.invalidateQueries({ queryKey:
 * queryKeys.projects.all })` stays correct even when the detail key later gains
 * a filter argument — which is exactly the kind of thing that silently rots
 * when keys are typed as string literals across fifty files.
 *
 * CLAUDE.md §52
 */
export const queryKeys = {
  auth: {
    session: ['auth', 'session'] as const,
  },

  workspaces: {
    all: ['workspaces'] as const,
    detail: (workspaceId: string) => ['workspaces', workspaceId] as const,
    members: (workspaceId: string) => ['workspaces', workspaceId, 'members'] as const,
    invitations: ['workspaces', 'invitations'] as const,
  },

  projects: {
    all: ['projects'] as const,
    list: (workspaceId: string) => ['projects', 'list', workspaceId] as const,
    detail: (projectId: string) => ['projects', 'detail', projectId] as const,
  },

  documents: {
    all: ['documents'] as const,
    list: (workspaceId: string) => ['documents', 'list', workspaceId] as const,
    detail: (documentId: string) => ['documents', 'detail', documentId] as const,
    versions: (documentId: string) => ['documents', 'detail', documentId, 'versions'] as const,
    comments: (documentId: string) => ['documents', 'detail', documentId, 'comments'] as const,
    shares: (documentId: string) => ['documents', 'detail', documentId, 'shares'] as const,
  },

  labels: {
    list: (workspaceId: string) => ['labels', workspaceId] as const,
  },

  tasks: {
    all: ['tasks'] as const,
    list: (workspaceId: string) => ['tasks', 'list', workspaceId] as const,
    detail: (taskId: string) => ['tasks', 'detail', taskId] as const,
  },

  comments: {
    all: ['comments'] as const,
    forResource: (resourceType: string, resourceId: string) =>
      ['comments', resourceType, resourceId] as const,
  },

  activity: {
    all: ['activity'] as const,
    list: (workspaceId: string) => ['activity', workspaceId] as const,
  },

  notifications: {
    all: ['notifications'] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
  },

  search: {
    all: ['search'] as const,
    query: (term: string) => ['search', term] as const,
  },

  dashboard: {
    all: ['dashboard'] as const,
    summary: (workspaceId: string) => ['dashboard', 'summary', workspaceId] as const,
  },
} as const
