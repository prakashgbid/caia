import { getSupabaseClient } from '../client.js'
import type { NotificationPreferences, UpdateNotificationPreferencesInput } from '../types.js'

const DEFAULT_PREFERENCES: Omit<NotificationPreferences, 'id' | 'updated_at'> = {
  user_id: '',
  channels: ['in_app'],
  new_reply: true,
  new_follower: true,
  group_activity: true,
  event_reminder: true,
  mention: true,
}

export async function getPreferences(userId: string): Promise<NotificationPreferences> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error ?? !data) {
    // Return defaults without persisting — caller can upsert if they want
    return {
      ...DEFAULT_PREFERENCES,
      id: '',
      user_id: userId,
      updated_at: new Date().toISOString(),
    }
  }

  return data as NotificationPreferences
}

export async function updatePreferences(
  userId: string,
  prefs: UpdateNotificationPreferencesInput,
): Promise<NotificationPreferences | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('notification_preferences')
    .upsert({ user_id: userId, ...prefs }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error ?? !data) return null
  return data as NotificationPreferences
}
