import { getSupabaseClient } from '../client.js'
import type {
  Profile,
  UpdateProfileInput,
  PaginationParams,
  PaginatedResult,
  NotificationPreferences,
  UpdateNotificationPreferencesInput,
  DeliveredNotification,
} from '../types.js'

export class UserService {
  private get sb() {
    return getSupabaseClient()
  }

  // ---------------------------------------------------------------------------
  // Profile domain
  // ---------------------------------------------------------------------------

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.sb
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error ?? !data) return null
    return data as Profile
  }

  async getProfileByUsername(username: string): Promise<Profile | null> {
    const { data, error } = await this.sb
      .from('profiles')
      .select('*')
      .ilike('username', username)
      .single()

    if (error ?? !data) return null
    return data as Profile
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<Profile | null> {
    const { data, error } = await this.sb
      .from('profiles')
      .update(input)
      .eq('id', userId)
      .select()
      .single()

    if (error ?? !data) return null
    return data as Profile
  }

  async listProfiles(params: PaginationParams = {}): Promise<PaginatedResult<Profile>> {
    const limit = params.limit ?? 50
    const offset = params.offset ?? 0

    const { data, error, count } = await this.sb
      .from('profiles')
      .select('*', { count: 'exact' })
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false })

    if (error) return { data: [], total: 0, hasMore: false }

    const total = count ?? 0
    return {
      data: (data ?? []) as Profile[],
      total,
      hasMore: offset + limit < total,
    }
  }

  async searchProfiles(query: string, limit = 20): Promise<Profile[]> {
    const pattern = `%${query}%`

    const { data, error } = await this.sb
      .from('profiles')
      .select('*')
      .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
      .limit(limit)
      .order('lifetime_points', { ascending: false })

    if (error) return []
    return (data ?? []) as Profile[]
  }

  // ---------------------------------------------------------------------------
  // Settings domain
  // ---------------------------------------------------------------------------

  async getSettings(userId: string): Promise<NotificationPreferences | null> {
    const { data, error } = await this.sb
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error ?? !data) return null
    return data as NotificationPreferences
  }

  async updateSettings(
    userId: string,
    settings: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferences | null> {
    const { data, error } = await this.sb
      .from('notification_preferences')
      .upsert({ user_id: userId, ...settings }, { onConflict: 'user_id' })
      .select()
      .single()

    if (error ?? !data) return null
    return data as NotificationPreferences
  }

  // ---------------------------------------------------------------------------
  // Notifications domain
  // ---------------------------------------------------------------------------

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

export const userService = new UserService()
