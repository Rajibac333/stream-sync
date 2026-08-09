import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { queryKeys } from '@/api/queryKeys'
import { workspacesApi } from '@/api/workspaces'
import { useSession } from '@/hooks/useAuth'
import { useUiStore } from '@/store/uiStore'
import type { PendingInvitation, Workspace } from '@/types/workspace'

/** Workspaces the signed-in user belongs to. (CLAUDE.md §28) */
export function useWorkspaces(): UseQueryResult<Workspace[]> {
  const { data: session } = useSession()

  return useQuery({
    queryKey: queryKeys.workspaces.all,
    queryFn: () => workspacesApi.list(),
    // Without a session there is nobody to list workspaces for, and firing the
    // request anyway just produces a guaranteed 401 on every login screen.
    enabled: session != null,
    staleTime: 5 * 60_000,
  })
}

/**
 * Invitations waiting for this user. (CLAUDE.md §28)
 *
 * Fetched alongside the workspace list because the two answer one question
 * between them — "where can I work?" — and a user with no workspaces but one
 * invitation would otherwise be shown a dead end.
 */
export function usePendingInvitations(): UseQueryResult<PendingInvitation[]> {
  const { data: session } = useSession()

  return useQuery({
    queryKey: queryKeys.workspaces.invitations,
    queryFn: () => workspacesApi.invitations(),
    enabled: session != null,
    staleTime: 60_000,
  })
}

/** Accepting turns the invitation into a membership, so both lists change. */
export function useAcceptInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (workspaceId: string) => workspacesApi.acceptInvitation(workspaceId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.invitations }),
      ])
    },
  })
}

export interface ActiveWorkspaceState {
  workspace: Workspace | null
  workspaces: Workspace[]
  isLoading: boolean
}

/**
 * Resolves which workspace the shell is currently showing.
 *
 * Most routes carry `:workspaceId`, but /app/dashboard does not — and the
 * sidebar, switcher and breadcrumbs still need a workspace to link into. The
 * resolution order is:
 *
 *   1. the `:workspaceId` in the URL — the URL always wins, so a shared link
 *      opens the workspace it points at
 *   2. the last workspace this user visited, persisted across sessions
 *   3. the first workspace they belong to
 *
 * A `:workspaceId` that the user has no access to resolves to null rather than
 * silently falling through to another workspace, so the screen can say so.
 */
/**
 * Pulls `:workspaceId` out of the pathname.
 *
 * Deliberately not `useParams`. The shell's consumers — sidebar, breadcrumbs,
 * switcher — render inside AppShell, which is a *pathless layout route*.
 * `useParams` only sees params matched up to the route that owns the calling
 * component, so from a layout route the child's `:workspaceId` is invisible and
 * would silently read as undefined on every workspace page.
 */
function readWorkspaceIdFromPath(pathname: string): string | undefined {
  return /^\/app\/workspaces\/([^/]+)/.exec(pathname)?.[1]
}

export function useActiveWorkspace(): ActiveWorkspaceState {
  const { pathname } = useLocation()
  const workspaceId = readWorkspaceIdFromPath(pathname)
  const { data: workspaces, isPending } = useWorkspaces()

  const lastWorkspaceId = useUiStore((state) => state.lastWorkspaceId)
  const setLastWorkspaceId = useUiStore((state) => state.setLastWorkspaceId)

  const available = workspaces ?? []

  const workspace = workspaceId
    ? (available.find((candidate) => candidate.id === workspaceId) ?? null)
    : (available.find((candidate) => candidate.id === lastWorkspaceId) ?? available[0] ?? null)

  // Remember the workspace only when the URL named it. Persisting a fallback
  // would let a stale "last visited" pin itself permanently.
  useEffect(() => {
    if (workspaceId && workspace && workspace.id !== lastWorkspaceId) {
      setLastWorkspaceId(workspace.id)
    }
  }, [workspaceId, workspace, lastWorkspaceId, setLastWorkspaceId])

  return { workspace, workspaces: available, isLoading: isPending }
}
