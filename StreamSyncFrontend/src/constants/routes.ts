/**
 * Route registry.
 *
 * Paths are declared once and built through functions so a route change is a
 * one-file edit rather than a grep-and-pray across every `<Link>` in the app.
 *
 * CLAUDE.md §24
 */

export const routes = {
  home: '/',

  auth: {
    login: '/login',
    register: '/register',
    forgotPassword: '/forgot-password',
  },

  app: {
    root: '/app',
    dashboard: '/app/dashboard',
  },

  workspace: {
    root: (workspaceId: string) => `/app/workspaces/${workspaceId}`,
    projects: (workspaceId: string) => `/app/workspaces/${workspaceId}/projects`,
    project: (workspaceId: string, projectId: string) =>
      `/app/workspaces/${workspaceId}/projects/${projectId}`,
    documents: (workspaceId: string) => `/app/workspaces/${workspaceId}/documents`,
    document: (workspaceId: string, documentId: string) =>
      `/app/workspaces/${workspaceId}/documents/${documentId}`,
    tasks: (workspaceId: string) => `/app/workspaces/${workspaceId}/tasks`,
    task: (workspaceId: string, taskId: string) =>
      `/app/workspaces/${workspaceId}/tasks/${taskId}`,
    activity: (workspaceId: string) => `/app/workspaces/${workspaceId}/activity`,
    members: (workspaceId: string) => `/app/workspaces/${workspaceId}/members`,
    settings: (workspaceId: string) => `/app/workspaces/${workspaceId}/settings`,
  },

  designSystem: '/design-system',
} as const

/** Route *patterns* for `<Route path>`, kept next to the builders above. */
export const routePatterns = {
  workspaceRoot: '/app/workspaces/:workspaceId',
  projects: '/app/workspaces/:workspaceId/projects',
  project: '/app/workspaces/:workspaceId/projects/:projectId',
  documents: '/app/workspaces/:workspaceId/documents',
  document: '/app/workspaces/:workspaceId/documents/:documentId',
  tasks: '/app/workspaces/:workspaceId/tasks',
  // Not named in §24, which lists the board. A task still needs an addressable
  // detail view (§43) — the command menu and activity feed already link to one.
  task: '/app/workspaces/:workspaceId/tasks/:taskId',
  activity: '/app/workspaces/:workspaceId/activity',
  members: '/app/workspaces/:workspaceId/members',
  settings: '/app/workspaces/:workspaceId/settings',
} as const
