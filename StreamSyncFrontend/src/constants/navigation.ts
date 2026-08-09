import {
  Activity,
  FileText,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'

import { routes } from '@/constants/routes'

/**
 * Sidebar navigation. (CLAUDE.md §27)
 *
 * Declared as data rather than as JSX so the same list drives the desktop rail,
 * the mobile drawer and the command menu's "go to" results — three surfaces
 * that must never disagree about what the app contains.
 *
 * Every destination except the dashboard is workspace-scoped, so `to` is a
 * function of the active workspace rather than a constant.
 */

export interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  to: (workspaceId: string) => string
  /** Disabled while no workspace has resolved yet. */
  requiresWorkspace: boolean
  /**
   * Matching rule for the active state. `exact` is needed for the dashboard,
   * whose path is a prefix of nothing, and for section roots that would
   * otherwise stay highlighted while a child route is open.
   */
  match: 'exact' | 'prefix'
}

export const primaryNavigation: readonly NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    to: () => routes.app.dashboard,
    requiresWorkspace: false,
    match: 'exact',
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: FolderKanban,
    to: (workspaceId) => routes.workspace.projects(workspaceId),
    requiresWorkspace: true,
    match: 'prefix',
  },
  {
    id: 'documents',
    label: 'Documents',
    icon: FileText,
    to: (workspaceId) => routes.workspace.documents(workspaceId),
    requiresWorkspace: true,
    match: 'prefix',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: ListChecks,
    to: (workspaceId) => routes.workspace.tasks(workspaceId),
    requiresWorkspace: true,
    match: 'prefix',
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: Activity,
    to: (workspaceId) => routes.workspace.activity(workspaceId),
    requiresWorkspace: true,
    match: 'prefix',
  },
]

/** Pinned to the bottom of the sidebar — reference, not day-to-day work. */
export const secondaryNavigation: readonly NavItem[] = [
  {
    id: 'members',
    label: 'Members',
    icon: Users,
    to: (workspaceId) => routes.workspace.members(workspaceId),
    requiresWorkspace: true,
    match: 'prefix',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    to: (workspaceId) => routes.workspace.settings(workspaceId),
    requiresWorkspace: true,
    match: 'prefix',
  },
]

/** True when `pathname` should highlight `item`. */
export function isNavItemActive(item: NavItem, pathname: string, workspaceId: string): boolean {
  const target = item.to(workspaceId)
  if (item.match === 'exact') return pathname === target
  return pathname === target || pathname.startsWith(`${target}/`)
}
