import { getSupabaseClient } from '../client.js'
import type { DeliveredNotification, PaginationParams, PaginatedResult } from '../types.js'

export class UserNotificationsService {
  private get sb() {
    return getSupabaseClient()
  }

  async getNotifications(
    userId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResult<DeliveredNotification>> {
    const limit = params.limit ?? 50
    const offset = params.offset ?? 0

    const { data, error, count } = await this.sb
      .from('delivered_notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false })

    if (error) return { data: [], total: 0, hasMore: false }

    const total = count ?? 0
    return {
      data: (data ?? []) as DeliveredNotification[],
      total,
      hasMore: offset + limit < total,
    }
  }

  async markRead(notificationId: string, userId: string): Promise<boolean> {
    const { error } = await this.sb
      .from('delivered_notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('user_id', userId)

    return !error
  }

  async markAllRead(userId: string): Promise<boolean> {
    const { error } = await this.sb
      .from('delivered_notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('is_read', false)

    return !error
  }

  async getUnreadCount(userId: string): Promise<number> {
    const { count, error } = await this.sb
      .from('delivered_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)

    if (error) return 0
    return count ?? 0
  }
}

export const userNotificationsService = new UserNotificationsService()
