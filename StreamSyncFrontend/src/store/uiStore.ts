import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { TaskStatus } from '@/types/task'

/**
 * Client-side UI state only — chrome, not data.
 *
 * Nothing that the server owns belongs in here. Projects, documents, tasks and
 * members live in TanStack Query; duplicating them into Zustand is how caches
 * drift out of sync. (CLAUDE.md §53)
 */

interface UiState {
  /** Desktop sidebar collapsed to icon rail. Persisted — it's a preference. */
  sidebarCollapsed: boolean
  /** Mobile drawer. Never persisted; it should always start closed. (§18) */
  mobileNavOpen: boolean
  /** Cmd/Ctrl+K palette. (§30) */
  commandMenuOpen: boolean
  /**
   * Last workspace the user was looking at. Persisted so /app/dashboard — which
   * carries no :workspaceId — can resolve a workspace for the switcher and the
   * sidebar links. It is a navigation *preference*, not workspace data; the
   * workspaces themselves stay in TanStack Query. (§53)
   */
  lastWorkspaceId: string | null
  /**
   * Which creation dialog is open, if any.
   *
   * Central because four different surfaces open the same dialogs — the
   * command menu, the workspace quick actions, the page headers and each
   * Kanban column's "+". Holding it per-page meant those global entry points
   * had nothing to call, which is exactly why they were still raising
   * "arrives in Milestone 4" toasts after the dialogs shipped.
   */
  createDialog: CreateDialogState | null
  /**
   * Breadcrumb trail published by the current page, when it knows more than the
   * URL does. Cleared on unmount, so a stale trail can never outlive its page.
   */
  breadcrumbTrail: readonly BreadcrumbCrumb[] | null

  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setMobileNavOpen: (open: boolean) => void
  setCommandMenuOpen: (open: boolean) => void
  toggleCommandMenu: () => void
  setLastWorkspaceId: (workspaceId: string) => void
  openCreateDialog: (dialog: CreateDialogState) => void
  closeCreateDialog: () => void
  setBreadcrumbTrail: (trail: readonly BreadcrumbCrumb[] | null) => void
}

/** Mirrors `Crumb` in Breadcrumbs, declared here to avoid a circular import. */
export interface BreadcrumbCrumb {
  label: string
  to?: string
}

/** Which dialog, plus whatever context the caller can usefully pre-fill. */
export type CreateDialogState =
  | { kind: 'workspace' }
  | { kind: 'project' }
  | { kind: 'document'; projectId?: string }
  | { kind: 'task'; projectId?: string; status?: TaskStatus }

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      commandMenuOpen: false,
      lastWorkspaceId: null,
      createDialog: null,
      breadcrumbTrail: null,

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      setCommandMenuOpen: (commandMenuOpen) => set({ commandMenuOpen }),
      toggleCommandMenu: () => set((state) => ({ commandMenuOpen: !state.commandMenuOpen })),
      setLastWorkspaceId: (lastWorkspaceId) => set({ lastWorkspaceId }),
      openCreateDialog: (createDialog) => set({ createDialog }),
      closeCreateDialog: () => set({ createDialog: null }),
      setBreadcrumbTrail: (breadcrumbTrail) => set({ breadcrumbTrail }),
    }),
    {
      name: 'streamsync-ui',
      version: 1,
      // Transient overlay state is excluded on purpose: restoring an open
      // command menu on page load would be baffling.
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        lastWorkspaceId: state.lastWorkspaceId,
      }),
    },
  ),
)
