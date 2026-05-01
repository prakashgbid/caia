import { getSupabaseClient } from '../client.js'
import type { NotificationPreferences, UpdateNotificationPreferencesInput } from '../types.js'

export class UserSettingsService {
  private get sb() {
    return getSupabaseClient()
  }

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
}

export const userSettingsService = new UserSettingsService()
