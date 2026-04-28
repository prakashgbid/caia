import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { sendNotification, getPreferences, updatePreferences } from '../src/notifications/index.js'
import { getUnreadCount, markRead, getNotifications } from '../src/users/index.js'
import { getSupabaseAdmin } from '../src/client.js'

const SUPABASE_URL = process.env['SUPABASE_URL']
const USER_ID = '00000000-0000-0000-0000-000000000060'

const createdNotificationIds: string[] = []

describe('notifications', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL) return
    const admin = getSupabaseAdmin()
    await admin.from('profiles').upsert({
      id: USER_ID,
      username: 'notif_user',
      display_name: 'Notif User',
      tier: 'member',
      lifetime_points: 0,
    })
  })

  afterEach(async () => {
    if (!SUPABASE_URL || createdNotificationIds.length === 0) return
    const admin = getSupabaseAdmin()
    await admin.from('delivered_notifications').delete().in('id', createdNotificationIds)
    createdNotificationIds.length = 0
  })

  it('sendNotification creates a delivered notification record', async () => {
    if (!SUPABASE_URL) return
    const notif = await sendNotification(USER_ID, 'new_reply', 'Someone replied', 'Check it out', '/threads/123')
    expect(notif).not.toBeNull()
    expect(notif?.is_read).toBe(false)
    expect(notif?.kind).toBe('new_reply')
    createdNotificationIds.push(notif!.id)
  })

  it('markRead marks a notification as read', async () => {
    if (!SUPABASE_URL) return
    const notif = await sendNotification(USER_ID, 'mention', 'You were mentioned')
    createdNotificationIds.push(notif!.id)

    const result = await markRead(notif!.id, USER_ID)
    expect(result).toBe(true)

    const admin = getSupabaseAdmin()
    const { data } = await admin
      .from('delivered_notifications')
      .select('is_read')
      .eq('id', notif!.id)
      .single()
    expect((data as { is_read: boolean }).is_read).toBe(true)
  })

  it('getUnreadCount returns correct count', async () => {
    if (!SUPABASE_URL) return
    const before = await getUnreadCount(USER_ID)

    const n1 = await sendNotification(USER_ID, 'new_follower', 'New follower')
    const n2 = await sendNotification(USER_ID, 'group_activity', 'Group update')
    createdNotificationIds.push(n1!.id, n2!.id)

    const after = await getUnreadCount(USER_ID)
    expect(after).toBe(before + 2)
  })

  it('getPreferences returns defaults for user without prefs', async () => {
    if (!SUPABASE_URL) return
    // Use a different user with no prefs
    const prefs = await getPreferences('00000000-0000-0000-0000-000000000099')
    expect(prefs.new_reply).toBe(true)
    expect(prefs.channels).toContain('in_app')
  })

  it('updatePreferences upserts preferences', async () => {
    if (!SUPABASE_URL) return
    const updated = await updatePreferences(USER_ID, { new_reply: false, channels: ['email'] })
    expect(updated?.new_reply).toBe(false)
    expect(updated?.channels).toContain('email')

    const admin = getSupabaseAdmin()
    await admin.from('notification_preferences').delete().eq('user_id', USER_ID)
  })

  it('getNotifications returns paginated list', async () => {
    if (!SUPABASE_URL) return
    const n = await sendNotification(USER_ID, 'event_reminder', 'Event tomorrow')
    createdNotificationIds.push(n!.id)

    const result = await getNotifications(USER_ID, { limit: 10 })
    expect(result.data.length).toBeGreaterThan(0)
    expect(result.total).toBeGreaterThan(0)
  })
})
