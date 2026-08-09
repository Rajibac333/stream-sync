import { api } from '@/api/client'
import type { Paginated } from '@/types/api'
import type { AppNotification, NotificationActor, NotificationType } from '@/types/notification'

/** Notification service. (CLAUDE.md §45) */

interface NotificationActorDto {
  id: string
  name: string
  avatar_url: string | null
}

interface NotificationDto {
  id: string
  type: NotificationType
  title: string
  body: string | null
  actor: NotificationActorDto | null
  href: string | null
  created_at: string
  read: boolean
}

function toActor(dto: NotificationActorDto): NotificationActor {
  return { id: dto.id, name: dto.name, avatarUrl: dto.avatar_url }
}

function toNotification(dto: NotificationDto): AppNotification {
  return {
    id: dto.id,
    type: dto.type,
    title: dto.title,
    body: dto.body,
    actor: dto.actor ? toActor(dto.actor) : null,
    href: dto.href,
    createdAt: dto.created_at,
    read: dto.read,
  }
}

export const notificationsApi = {
  async list(): Promise<AppNotification[]> {
    const page = await api.get<Paginated<NotificationDto>>('/notifications/')
    return page.results.map(toNotification)
  },

  async markRead(notificationId: string): Promise<void> {
    await api.patch<void>(`/notifications/${notificationId}/`, { read: true })
  },

  async markAllRead(): Promise<void> {
    await api.post<void>('/notifications/mark-all-read/')
  },
}
