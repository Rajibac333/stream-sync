import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import { notificationsApi } from '@/api/notifications'
import { queryKeys } from '@/api/queryKeys'
import { useSession } from '@/hooks/useAuth'
import type { AppNotification } from '@/types/notification'

/**
 * Notifications. (CLAUDE.md §45)
 *
 * Both mutations update the cache optimistically. Marking something read is the
 * kind of action where a spinner is worse than useless — the user has already
 * moved on, and the only thing a round-trip delay achieves is making the badge
 * look broken. On failure the previous list is restored.
 */

export function useNotifications(): UseQueryResult<AppNotification[]> {
  const { data: session } = useSession()

  return useQuery({
    queryKey: queryKeys.notifications.all,
    queryFn: () => notificationsApi.list(),
    enabled: session != null,
    staleTime: 60_000,
  })
}

export function useUnreadNotificationCount(): number {
  const { data } = useNotifications()
  return data?.filter((notification) => !notification.read).length ?? 0
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (notificationId: string) => notificationsApi.markRead(notificationId),

    onMutate: async (notificationId) => {
      // Cancel in-flight refetches first: one landing mid-mutation would
      // overwrite the optimistic update with the pre-mutation server state.
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.all })
      const previous = queryClient.getQueryData<AppNotification[]>(queryKeys.notifications.all)

      queryClient.setQueryData<AppNotification[]>(queryKeys.notifications.all, (current) =>
        current?.map((notification) =>
          notification.id === notificationId ? { ...notification, read: true } : notification,
        ),
      )

      return { previous }
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.notifications.all, context.previous)
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.all })
      const previous = queryClient.getQueryData<AppNotification[]>(queryKeys.notifications.all)

      queryClient.setQueryData<AppNotification[]>(queryKeys.notifications.all, (current) =>
        current?.map((notification) => ({ ...notification, read: true })),
      )

      return { previous }
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.notifications.all, context.previous)
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
    },
  })
}
