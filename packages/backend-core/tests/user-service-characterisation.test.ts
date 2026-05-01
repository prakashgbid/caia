/**
 * Characterisation tests for the user domain functions spread across:
 *   - src/users/profile.ts
 *   - src/users/settings.ts
 *   - src/users/notifications.ts
 *
 * These tests document CURRENT observable behaviour so that the upcoming
 * refactor into a unified UserService class cannot silently change semantics.
 * Run against a real Supabase instance (SUPABASE_URL must be set).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  getProfile,
  getProfileByUsername,
  updateProfile,
  listProfiles,
  searchProfiles,
  getSettings,
  updateSettings,
  getNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
} from '../src/users/index.js'
import { getSupabaseAdmin } from '../src/client.js'

const SUPABASE_URL = process.env['SUPABASE_URL']

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const CHAR_USER_ID = '00000000-0000-0000-0000-000000000099'
const CHAR_USER_ID_2 = '00000000-0000-0000-0000-000000000098'
const MISSING_USER_ID = '00000000-0000-0000-0000-000000000000'
const CHAR_USERNAME = 'char_testuser_profile'
const CHAR_NOTIF_ID_1 = '00000000-1111-0000-0000-000000000001'
const CHAR_NOTIF_ID_2 = '00000000-1111-0000-0000-000000000002'

function skipIfNoSupabase() {
  if (!SUPABASE_URL) return true
  return false
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedProfiles() {
  const admin = getSupabaseAdmin()
  await admin.from('profiles').upsert([
    {
      id: CHAR_USER_ID,
      username: CHAR_USERNAME,
      display_name: 'Char Test User',
      tier: 'member',
      lifetime_points: 42,
      bio: 'characterisation test bio',
      location_state: 'TX',
      location_city: 'Austin',
    },
    {
      id: CHAR_USER_ID_2,
      username: 'char_testuser_secondary',
      display_name: 'Char Secondary',
      tier: 'contributor',
      lifetime_points: 10,
    },
  ])
}

async function seedNotifications() {
  const admin = getSupabaseAdmin()
  await admin.from('delivered_notifications').upsert([
    {
      id: CHAR_NOTIF_ID_1,
      user_id: CHAR_USER_ID,
      kind: 'new_reply',
      title: 'Char Notification 1',
      body: 'body 1',
      is_read: false,
    },
    {
      id: CHAR_NOTIF_ID_2,
      user_id: CHAR_USER_ID,
      kind: 'new_follower',
      title: 'Char Notification 2',
      body: 'body 2',
      is_read: false,
    },
  ])
}

// ---------------------------------------------------------------------------
// Profile characterisation
// ---------------------------------------------------------------------------

describe('characterisation: getProfile', () => {
  beforeAll(async () => {
    if (skipIfNoSupabase()) return
    await seedProfiles()
  })

  it('returns null for a non-existent userId', async () => {
    if (skipIfNoSupabase()) return
    const result = await getProfile(MISSING_USER_ID)
    expect(result).toBeNull()
  })

  it('returns a Profile object for an existing userId', async () => {
    if (skipIfNoSupabase()) return
    const profile = await getProfile(CHAR_USER_ID)
    expect(profile).not.toBeNull()
    expect(profile!.id).toBe(CHAR_USER_ID)
  })

  it('returned profile has all required fields', async () => {
    if (skipIfNoSupabase()) return
    const profile = await getProfile(CHAR_USER_ID)
    expect(profile).toMatchObject({
      id: expect.any(String),
      username: expect.any(String),
      tier: expect.any(String),
      lifetime_points: expect.any(Number),
      created_at: expect.any(String),
      updated_at: expect.any(String),
    })
  })

  it('returns nullable fields as null when not set', async () => {
    if (skipIfNoSupabase()) return
    // CHAR_USER_ID_2 was seeded without avatar_url/bio/location_*
    const profile = await getProfile(CHAR_USER_ID_2)
    expect(profile).not.toBeNull()
    expect(profile!.avatar_url).toBeNull()
    expect(profile!.bio).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('characterisation: getProfileByUsername', () => {
  beforeAll(async () => {
    if (skipIfNoSupabase()) return
    await seedProfiles()
  })

  it('returns a Profile when given exact username', async () => {
    if (skipIfNoSupabase()) return
    const profile = await getProfileByUsername(CHAR_USERNAME)
    expect(profile).not.toBeNull()
    expect(profile!.id).toBe(CHAR_USER_ID)
  })

  it('is case-insensitive (ilike)', async () => {
    if (skipIfNoSupabase()) return
    const profile = await getProfileByUsername(CHAR_USERNAME.toUpperCase())
    expect(profile).not.toBeNull()
    expect(profile!.id).toBe(CHAR_USER_ID)
  })

  it('returns null when username does not exist', async () => {
    if (skipIfNoSupabase()) return
    const result = await getProfileByUsername('definitelynothere_char_xyzabc')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('characterisation: updateProfile', () => {
  beforeAll(async () => {
    if (skipIfNoSupabase()) return
    await seedProfiles()
  })

  it('returns the updated Profile reflecting new values', async () => {
    if (skipIfNoSupabase()) return
    const updated = await updateProfile(CHAR_USER_ID, { display_name: 'Updated Char Name' })
    expect(updated).not.toBeNull()
    expect(updated!.display_name).toBe('Updated Char Name')
    expect(updated!.id).toBe(CHAR_USER_ID)
  })

  it('returns null when userId does not exist', async () => {
    if (skipIfNoSupabase()) return
    const result = await updateProfile(MISSING_USER_ID, { display_name: 'Ghost' })
    expect(result).toBeNull()
  })

  it('partial update preserves other fields', async () => {
    if (skipIfNoSupabase()) return
    const before = await getProfile(CHAR_USER_ID)
    await updateProfile(CHAR_USER_ID, { bio: 'new bio only' })
    const after = await getProfile(CHAR_USER_ID)
    expect(after!.username).toBe(before!.username)
    expect(after!.tier).toBe(before!.tier)
    expect(after!.bio).toBe('new bio only')
  })
})

// ---------------------------------------------------------------------------

describe('characterisation: listProfiles', () => {
  beforeAll(async () => {
    if (skipIfNoSupabase()) return
    await seedProfiles()
  })

  it('returns a PaginatedResult shape', async () => {
    if (skipIfNoSupabase()) return
    const result = await listProfiles()
    expect(result).toHaveProperty('data')
    expect(result).toHaveProperty('total')
    expect(result).toHaveProperty('hasMore')
    expect(Array.isArray(result.data)).toBe(true)
    expect(typeof result.total).toBe('number')
    expect(typeof result.hasMore).toBe('boolean')
  })

  it('defaults to limit=50 and offset=0', async () => {
    if (skipIfNoSupabase()) return
    const result = await listProfiles()
    expect(result.data.length).toBeLessThanOrEqual(50)
  })

  it('respects custom limit', async () => {
    if (skipIfNoSupabase()) return
    const result = await listProfiles({ limit: 1 })
    expect(result.data.length).toBeLessThanOrEqual(1)
  })

  it('hasMore is true when total exceeds limit+offset', async () => {
    if (skipIfNoSupabase()) return
    const check = await listProfiles({ limit: 1, offset: 0 })
    if (check.total > 1) {
      expect(check.hasMore).toBe(true)
    }
  })

  it('hasMore is false when on the last page', async () => {
    if (skipIfNoSupabase()) return
    const all = await listProfiles({ limit: 1000 })
    expect(all.hasMore).toBe(false)
  })

  it('orders by created_at descending', async () => {
    if (skipIfNoSupabase()) return
    const result = await listProfiles({ limit: 10 })
    for (let i = 1; i < result.data.length; i++) {
      expect(result.data[i - 1]!.created_at >= result.data[i]!.created_at).toBe(true)
    }
  })

  it('offset skips the first N profiles (page-2 behaviour)', async () => {
    // Verifies that offset is honoured so the refactored service cannot regress pagination.
    if (skipIfNoSupabase()) return
    const page1 = await listProfiles({ limit: 1, offset: 0 })
    const page2 = await listProfiles({ limit: 1, offset: 1 })
    if (page1.data.length === 1 && page2.data.length === 1) {
      expect(page1.data[0]!.id).not.toBe(page2.data[0]!.id)
    }
  })
})

// ---------------------------------------------------------------------------

describe('characterisation: searchProfiles', () => {
  beforeAll(async () => {
    if (skipIfNoSupabase()) return
    await seedProfiles()
  })

  it('returns an array', async () => {
    if (skipIfNoSupabase()) return
    const results = await searchProfiles('char_testuser')
    expect(Array.isArray(results)).toBe(true)
  })

  it('finds profiles by username match', async () => {
    if (skipIfNoSupabase()) return
    const results = await searchProfiles(CHAR_USERNAME)
    const found = results.find((p) => p.id === CHAR_USER_ID)
    expect(found).toBeDefined()
  })

  it('finds profiles by display_name match', async () => {
    if (skipIfNoSupabase()) return
    const results = await searchProfiles('Char Test User')
    const found = results.find((p) => p.id === CHAR_USER_ID)
    expect(found).toBeDefined()
  })

  it('returns empty array for no matches', async () => {
    if (skipIfNoSupabase()) return
    const results = await searchProfiles('zzznomatch_char_9999xyzxyz')
    expect(results).toEqual([])
  })

  it('respects the limit parameter', async () => {
    if (skipIfNoSupabase()) return
    const results = await searchProfiles('char_testuser', 1)
    expect(results.length).toBeLessThanOrEqual(1)
  })

  it('defaults to limit=20', async () => {
    if (skipIfNoSupabase()) return
    const results = await searchProfiles('a')
    expect(results.length).toBeLessThanOrEqual(20)
  })

  it('orders by lifetime_points descending', async () => {
    if (skipIfNoSupabase()) return
    const results = await searchProfiles('char_testuser')
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.lifetime_points >= results[i]!.lifetime_points).toBe(true)
    }
  })

  it('empty string query matches all profiles (up to limit)', async () => {
    // ilike '%' matches every row — documents that the caller, not the function, is
    // responsible for ensuring a meaningful query string.
    if (skipIfNoSupabase()) return
    const results = await searchProfiles('')
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(20)
  })
})

// ---------------------------------------------------------------------------
// Settings characterisation
// ---------------------------------------------------------------------------

describe('characterisation: getSettings', () => {
  beforeAll(async () => {
    if (skipIfNoSupabase()) return
    await seedProfiles()
  })

  it('returns null when no notification_preferences row exists for user', async () => {
    if (skipIfNoSupabase()) return
    const result = await getSettings(MISSING_USER_ID)
    expect(result).toBeNull()
  })

  it('returns NotificationPreferences after upsert', async () => {
    if (skipIfNoSupabase()) return
    await updateSettings(CHAR_USER_ID, { new_reply: true, new_follower: false })
    const settings = await getSettings(CHAR_USER_ID)
    expect(settings).not.toBeNull()
    expect(settings!.user_id).toBe(CHAR_USER_ID)
  })

  it('returned settings has expected boolean fields', async () => {
    if (skipIfNoSupabase()) return
    const settings = await getSettings(CHAR_USER_ID)
    if (!settings) return
    expect(typeof settings.new_reply).toBe('boolean')
    expect(typeof settings.new_follower).toBe('boolean')
    expect(typeof settings.group_activity).toBe('boolean')
    expect(typeof settings.event_reminder).toBe('boolean')
    expect(typeof settings.mention).toBe('boolean')
  })
})

// ---------------------------------------------------------------------------

describe('characterisation: updateSettings', () => {
  beforeAll(async () => {
    if (skipIfNoSupabase()) return
    await seedProfiles()
  })

  it('creates settings row if none exists (upsert semantics)', async () => {
    if (skipIfNoSupabase()) return
    const result = await updateSettings(CHAR_USER_ID_2, { mention: true })
    expect(result).not.toBeNull()
    expect(result!.user_id).toBe(CHAR_USER_ID_2)
  })

  it('updates existing settings row', async () => {
    if (skipIfNoSupabase()) return
    await updateSettings(CHAR_USER_ID, { new_reply: false })
    const result = await updateSettings(CHAR_USER_ID, { new_reply: true })
    expect(result!.new_reply).toBe(true)
  })

  it('returns the saved NotificationPreferences shape', async () => {
    if (skipIfNoSupabase()) return
    const result = await updateSettings(CHAR_USER_ID, { channels: ['in_app', 'email'] })
    expect(result).toMatchObject({
      id: expect.any(String),
      user_id: CHAR_USER_ID,
      updated_at: expect.any(String),
    })
  })

  it('only updates specified fields (partial upsert)', async () => {
    if (skipIfNoSupabase()) return
    await updateSettings(CHAR_USER_ID, { new_reply: true, new_follower: true })
    const updated = await updateSettings(CHAR_USER_ID, { new_reply: false })
    const fetched = await getSettings(CHAR_USER_ID)
    // new_reply changed, new_follower should still be true
    expect(fetched!.new_reply).toBe(false)
    expect(fetched!.new_follower).toBe(true)
    void updated
  })
})

// ---------------------------------------------------------------------------
// Notifications characterisation
// ---------------------------------------------------------------------------

describe('characterisation: getNotifications', () => {
  beforeAll(async () => {
    if (skipIfNoSupabase()) return
    await seedProfiles()
    await seedNotifications()
  })

  it('returns a PaginatedResult shape', async () => {
    if (skipIfNoSupabase()) return
    const result = await getNotifications(CHAR_USER_ID)
    expect(result).toHaveProperty('data')
    expect(result).toHaveProperty('total')
    expect(result).toHaveProperty('hasMore')
    expect(Array.isArray(result.data)).toBe(true)
  })

  it('returns only notifications for the given userId', async () => {
    if (skipIfNoSupabase()) return
    const result = await getNotifications(CHAR_USER_ID)
    for (const n of result.data) {
      expect(n.user_id).toBe(CHAR_USER_ID)
    }
  })

  it('returns empty PaginatedResult for user with no notifications', async () => {
    if (skipIfNoSupabase()) return
    const result = await getNotifications(MISSING_USER_ID)
    expect(result.data).toEqual([])
    expect(result.total).toBe(0)
    expect(result.hasMore).toBe(false)
  })

  it('defaults to limit=50 offset=0', async () => {
    if (skipIfNoSupabase()) return
    const result = await getNotifications(CHAR_USER_ID)
    expect(result.data.length).toBeLessThanOrEqual(50)
  })

  it('respects custom pagination params', async () => {
    if (skipIfNoSupabase()) return
    const result = await getNotifications(CHAR_USER_ID, { limit: 1, offset: 0 })
    expect(result.data.length).toBeLessThanOrEqual(1)
  })

  it('offset skips the first N notifications (page-2 behaviour)', async () => {
    if (skipIfNoSupabase()) return
    const page1 = await getNotifications(CHAR_USER_ID, { limit: 1, offset: 0 })
    const page2 = await getNotifications(CHAR_USER_ID, { limit: 1, offset: 1 })
    if (page1.data.length === 1 && page2.data.length === 1) {
      expect(page1.data[0]!.id).not.toBe(page2.data[0]!.id)
    }
  })

  it('orders by created_at descending', async () => {
    if (skipIfNoSupabase()) return
    const result = await getNotifications(CHAR_USER_ID, { limit: 10 })
    for (let i = 1; i < result.data.length; i++) {
      expect(result.data[i - 1]!.created_at >= result.data[i]!.created_at).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------

describe('characterisation: getUnreadCount', () => {
  beforeAll(async () => {
    if (skipIfNoSupabase()) return
    await seedProfiles()
    await seedNotifications()
  })

  it('returns a number', async () => {
    if (skipIfNoSupabase()) return
    const count = await getUnreadCount(CHAR_USER_ID)
    expect(typeof count).toBe('number')
  })

  it('returns 0 for a user with no notifications', async () => {
    if (skipIfNoSupabase()) return
    const count = await getUnreadCount(MISSING_USER_ID)
    expect(count).toBe(0)
  })

  it('counts only unread notifications', async () => {
    if (skipIfNoSupabase()) return
    // Both seeded notifications are unread
    const count = await getUnreadCount(CHAR_USER_ID)
    expect(count).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------

describe('characterisation: markRead', () => {
  beforeAll(async () => {
    if (skipIfNoSupabase()) return
    await seedProfiles()
    await seedNotifications()
  })

  it('returns true on success', async () => {
    if (skipIfNoSupabase()) return
    const result = await markRead(CHAR_NOTIF_ID_1, CHAR_USER_ID)
    expect(result).toBe(true)
  })

  it('sets is_read to true on the notification', async () => {
    if (skipIfNoSupabase()) return
    await markRead(CHAR_NOTIF_ID_1, CHAR_USER_ID)
    const admin = getSupabaseAdmin()
    const { data } = await admin
      .from('delivered_notifications')
      .select('is_read')
      .eq('id', CHAR_NOTIF_ID_1)
      .single()
    expect(data?.is_read).toBe(true)
  })

  it('returns true even when notification is already read (idempotent)', async () => {
    if (skipIfNoSupabase()) return
    await markRead(CHAR_NOTIF_ID_1, CHAR_USER_ID)
    const result = await markRead(CHAR_NOTIF_ID_1, CHAR_USER_ID)
    expect(result).toBe(true)
  })

  it('does not mark notification for wrong userId', async () => {
    if (skipIfNoSupabase()) return
    // Reset to unread first
    const admin = getSupabaseAdmin()
    await admin
      .from('delivered_notifications')
      .update({ is_read: false, read_at: null })
      .eq('id', CHAR_NOTIF_ID_2)

    // Attempt mark with wrong user
    await markRead(CHAR_NOTIF_ID_2, MISSING_USER_ID)

    const { data } = await admin
      .from('delivered_notifications')
      .select('is_read')
      .eq('id', CHAR_NOTIF_ID_2)
      .single()
    expect(data?.is_read).toBe(false)
  })

  it('returns true for a completely non-existent notificationId (no-op, no error)', async () => {
    // Supabase update() against 0 matching rows is not an error — markRead returns !error === true.
    // This documents the lenient (no-op-is-ok) contract the refactored service must preserve.
    if (skipIfNoSupabase()) return
    const NON_EXISTENT_NOTIF_ID = '00000000-1111-0000-0000-000000000099'
    const result = await markRead(NON_EXISTENT_NOTIF_ID, CHAR_USER_ID)
    expect(result).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('characterisation: markAllRead', () => {
  beforeAll(async () => {
    if (skipIfNoSupabase()) return
    await seedProfiles()
    // Re-seed notifications as unread
    const admin = getSupabaseAdmin()
    await admin
      .from('delivered_notifications')
      .update({ is_read: false, read_at: null })
      .in('id', [CHAR_NOTIF_ID_1, CHAR_NOTIF_ID_2])
  })

  it('returns true on success', async () => {
    if (skipIfNoSupabase()) return
    const result = await markAllRead(CHAR_USER_ID)
    expect(result).toBe(true)
  })

  it('sets all unread notifications to is_read=true', async () => {
    if (skipIfNoSupabase()) return
    // Reset to unread
    const admin = getSupabaseAdmin()
    await admin
      .from('delivered_notifications')
      .update({ is_read: false, read_at: null })
      .in('id', [CHAR_NOTIF_ID_1, CHAR_NOTIF_ID_2])

    await markAllRead(CHAR_USER_ID)

    const count = await getUnreadCount(CHAR_USER_ID)
    expect(count).toBe(0)
  })

  it('returns true even when there are no unread notifications', async () => {
    if (skipIfNoSupabase()) return
    await markAllRead(CHAR_USER_ID) // already all read from above
    const result = await markAllRead(CHAR_USER_ID)
    expect(result).toBe(true)
  })

  it('does not affect notifications of other users', async () => {
    if (skipIfNoSupabase()) return
    // Re-seed unread for CHAR_USER_ID
    const admin = getSupabaseAdmin()
    await admin
      .from('delivered_notifications')
      .update({ is_read: false, read_at: null })
      .in('id', [CHAR_NOTIF_ID_1, CHAR_NOTIF_ID_2])

    // Mark all read for a different user
    await markAllRead(CHAR_USER_ID_2)

    // CHAR_USER_ID notifications should still be unread
    const count = await getUnreadCount(CHAR_USER_ID)
    expect(count).toBeGreaterThanOrEqual(2)
  })
})
