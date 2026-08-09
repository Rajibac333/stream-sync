import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/api/queryKeys'
import { workspacesApi, type UpdateWorkspacePayload } from '@/api/workspaces'
import { toast } from '@/store/toastStore'
import { isApiError } from '@/types/api'
import type { WorkspaceRole } from '@/types/auth'
import type { WorkspaceMember } from '@/types/workspace'

/**
 * Membership and workspace writes. (CLAUDE.md §26, §52, §80)
 *
 * Every one of these is a *server* decision the client is merely requesting.
 * The Members screen hides controls a Viewer cannot use, but that is
 * convenience — the mock service enforces the same rules (last owner, duplicate
 * invitation) precisely because Django will, and a UI built against a
 * permissive fake learns the wrong error states.
 */

function describeError(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback
}

/**
 * The roster and the workspace list move together.
 *
 * `memberCount` lives on the workspace, so an invitation that updated only the
 * roster would leave the switcher and the workspace card showing the old
 * figure — the same "badge disagrees with its list" problem the task counters
 * already solved by deriving.
 */
function invalidateMembership(queryClient: QueryClient, workspaceId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.members(workspaceId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.activity.list(workspaceId) })
}

export function useInviteMember(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: WorkspaceRole }) =>
      workspacesApi.invite({ workspaceId, email, role }),

    onSuccess: (member) => {
      invalidateMembership(queryClient, workspaceId)
      toast.success({
        title: `Invited ${member.user.email}`,
        description: `They will join as ${member.role} once they accept.`,
      })
    },
    // Field-level errors (duplicate address) are shown on the input by the
    // caller; only unexpected failures become a toast.
  })
}

export function useUpdateMemberRole(workspaceId: string) {
  const queryClient = useQueryClient()
  const key = queryKeys.workspaces.members(workspaceId)

  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: WorkspaceRole }) =>
      workspacesApi.updateMemberRole(workspaceId, memberId, role),

    /* Optimistic: a role select that waits for a round trip before the value
       changes reads as a control that ignored the click. The server can still
       refuse — demoting the last owner does — and the rollback restores the
       previous value with an explanation. */
    onMutate: async ({ memberId, role }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<WorkspaceMember[]>(key)

      queryClient.setQueryData<WorkspaceMember[]>(key, (members) =>
        members?.map((member) => (member.id === memberId ? { ...member, role } : member)),
      )

      return { previous }
    },

    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast.error({
        title: "Couldn't change that role",
        description: describeError(error, 'Please try again.'),
      })
    },

    onSuccess: (members) => queryClient.setQueryData(key, members),
    onSettled: () => invalidateMembership(queryClient, workspaceId),
  })
}

export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ memberId }: { memberId: string; name: string }) =>
      workspacesApi.removeMember(workspaceId, memberId),

    /* Not optimistic, unlike the role change. Removal is destructive and sits
       behind a confirmation dialog, so the extra moment costs nothing — and a
       row that vanishes and reappears is a far worse failure than one that
       takes 300ms to go. */
    onSuccess: (members, { name }) => {
      queryClient.setQueryData(queryKeys.workspaces.members(workspaceId), members)
      invalidateMembership(queryClient, workspaceId)
      toast.success({ title: `${name} no longer has access` })
    },

    onError: (error) =>
      toast.error({
        title: "Couldn't remove that person",
        description: describeError(error, 'Please try again.'),
      }),
  })
}

/** Workspace name and description. (§80) */
export function useUpdateWorkspace(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (patch: UpdateWorkspacePayload) => workspacesApi.update(workspaceId, patch),
    onSuccess: (workspace) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      toast.success({ title: 'Workspace updated', description: workspace.name })
    },
  })
}
