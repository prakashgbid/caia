import { getSupabaseClient } from '../client.js'
import type { NotificationPreferences, UpdateNotificationPreferencesInput } from '../types.js'

export async function getSettings(userId: string): Promise<NotificationPreferences | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error ?? !data) return null
  return data as NotificationPreferences
}

export async function updateSettings(
  userId: string,
  settings: UpdateNotificationPreferencesInput,
): Promise<NotificationPreferences | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('notification_preferences')
    .upsert({ user_id: userId, ...settings }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error ?? !data) return null
  return data as NotificationPreferences
}
