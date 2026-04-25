import { getSupabaseClient } from '../client.js'
import type { DeliveredNotification, PaginationParams, PaginatedResult } from '../types.js'

export async function getNotifications(
  userId: string,
  params: PaginationParams = {},
): Promise<PaginatedResult<DeliveredNotification>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  const { data, error, count } = await sb
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

export async function markRead(
  notificationId: string,
  userId: string,
): Promise<boolean> {
  const sb = getSupabaseClient()
  const { error } = await sb
    .from('delivered_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId)

  return !error
}

export async function markAllRead(userId: string): Promise<boolean> {
  const sb = getSupabaseClient()
  const { error } = await sb
    .from('delivered_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_read', false)

  return !error
}

export async function getUnreadCount(userId: string): Promise<number> {
  const sb = getSupabaseClient()
  const { count, error } = await sb
    .from('delivered_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false)

  if (error) return 0
  return count ?? 0
}
