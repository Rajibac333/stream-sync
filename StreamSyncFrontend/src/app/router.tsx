import { lazy, Suspense, type ComponentType } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'

import { RedirectIfAuthenticated, RequireAuth } from '@/components/auth/routeGuards'
import { AppShell } from '@/components/layout/AppShell'
import { RouteError } from '@/components/layout/RouteError'
import { RouteFallback } from '@/components/layout/RouteFallback'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { config } from '@/app/config'
import { routePatterns, routes } from '@/constants/routes'

/**
 * Route table. (CLAUDE.md §24)
 *
 * Three layers rather than a flat list, so each concern is declared once:
 *
 *   RedirectIfAuthenticated → the auth screens, closed to signed-in users
 *   RequireAuth → AppShell  → everything under /app
 *   (neither)               → landing redirect and 404
 *
 * Protection therefore cannot be forgotten on a new page: a route added under
 * the AppShell branch inherits the guard, and there is no way to add one
 * "inside the app" without it.
 *
 * Every path §24 requires is backed by a real screen.
 */

// A route table necessarily exports a non-component (`router`) while holding
// component references. It is not a Fast Refresh boundary — the pages it points
// at are — so the rule has nothing to protect here.
// eslint-disable-next-line react/only-export-components
const DesignSystemPage = lazy(() =>
  import('@/pages/design-system/DesignSystemPage').then((module) => ({
    default: module.DesignSystemPage,
  })),
)

/**
 * Authenticated screens are code-split; the auth screens are not.
 *
 * A signed-out visitor's first paint is the login form, and it should not carry
 * the Kanban board, the drag-and-drop engine or the project pages with it.
 * Splitting on the authenticated boundary is the cut that matches how the app
 * is actually used — one bundle to sign in, the rest once you are in. (§65)
 *
 * `lazyRoute` keeps each one a one-liner and wraps the named export, since
 * these modules deliberately do not use default exports.
 */
// eslint-disable-next-line react/only-export-components
function lazyRoute<K extends string>(
  loader: () => Promise<Record<K, ComponentType>>,
  name: K,
) {
  return lazy(async () => ({ default: (await loader())[name] }))
}

const DashboardPage = lazyRoute(() => import('@/pages/dashboard/DashboardPage'), 'DashboardPage')
const WorkspacePage = lazyRoute(() => import('@/pages/workspace/WorkspacePage'), 'WorkspacePage')
const ProjectsPage = lazyRoute(() => import('@/pages/projects/ProjectsPage'), 'ProjectsPage')
const ProjectDetailPage = lazyRoute(
  () => import('@/pages/projects/ProjectDetailPage'),
  'ProjectDetailPage',
)
const DocumentsPage = lazyRoute(() => import('@/pages/documents/DocumentsPage'), 'DocumentsPage')
// Tiptap and ProseMirror are a large dependency that only this screen needs,
// so this split is the one that most justifies itself. (§65)
const DocumentEditorPage = lazyRoute(
  () => import('@/pages/documents/DocumentEditorPage'),
  'DocumentEditorPage',
)
const TasksPage = lazyRoute(() => import('@/pages/tasks/TasksPage'), 'TasksPage')
const ActivityPage = lazyRoute(() => import('@/pages/activity/ActivityPage'), 'ActivityPage')
const MembersPage = lazyRoute(() => import('@/pages/members/MembersPage'), 'MembersPage')
const SettingsPage = lazyRoute(() => import('@/pages/settings/SettingsPage'), 'SettingsPage')

/** Workspace-scoped screens. All render inside the shell. */
const workspaceRoutes: RouteObject[] = [
  { path: routePatterns.workspaceRoot, element: <WorkspacePage /> },
  { path: routePatterns.projects, element: <ProjectsPage /> },
  { path: routePatterns.project, element: <ProjectDetailPage /> },
  { path: routePatterns.documents, element: <DocumentsPage /> },
  { path: routePatterns.document, element: <DocumentEditorPage /> },
  { path: routePatterns.tasks, element: <TasksPage /> },
  // Same screen as the board: the open task lives in the URL so it can be
  // linked to, and Back closes the dialog.
  { path: routePatterns.task, element: <TasksPage /> },
  { path: routePatterns.activity, element: <ActivityPage /> },
  { path: routePatterns.members, element: <MembersPage /> },
  { path: routePatterns.settings, element: <SettingsPage /> },
]

const routeObjects: RouteObject[] = [
  // A marketing site is out of scope; "/" is the way into the product.
  { path: routes.home, element: <Navigate to={routes.app.dashboard} replace /> },

  {
    element: <RedirectIfAuthenticated />,
    children: [
      { path: routes.auth.login, element: <LoginPage /> },
      { path: routes.auth.register, element: <RegisterPage /> },
      { path: routes.auth.forgotPassword, element: <ForgotPasswordPage /> },
    ],
  },

  {
    element: <RequireAuth />,
    children: [
      {
        // A single Suspense boundary inside the shell: the sidebar and topbar
        // stay on screen while a route chunk loads, so navigation never blanks
        // the page. RouteFallback mirrors the page's shape rather than
        // showing a spinner. (§59)
        element: <AppShell />,
        children: [
          { path: routes.app.root, element: <Navigate to={routes.app.dashboard} replace /> },
          { path: routes.app.dashboard, element: <DashboardPage /> },
          ...workspaceRoutes,
        ],
      },
    ],
  },

  /* Dev-only: the living reference for the design system.
     Gated on `import.meta.env.DEV` as well as the feature flag, so the route
     cannot be re-enabled in production by setting VITE_ENABLE_DEVTOOLS=true in
     a deploy environment — a `.env.example` copied to the server is exactly how
     that happens. The lazy chunk is still emitted (a module-scope `import()`
     always is) but nothing can route to it. */
  ...(import.meta.env.DEV && config.features.devtools
    ? [
        {
          path: routes.designSystem,
          element: (
            <Suspense fallback={<RouteFallback />}>
              <DesignSystemPage />
            </Suspense>
          ),
        },
      ]
    : []),

  { path: '*', element: <NotFoundPage /> },
]

export const router = createBrowserRouter(
  routeObjects.map((route) => ({
    ...route,
    // A thrown render or loader error takes down one branch, not the app.
    // Must be an element that reads `useRouteError` — a plain React error
    // boundary receives nothing here and would render blank.
    errorElement: <RouteError />,
  })),
)
