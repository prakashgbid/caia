import { describe, it, expect, beforeAll } from 'vitest'
import { getSupabaseAdmin } from '../../src/client.js'
import { getProfile, updateProfile } from '../../src/users/index.js'
import { createGroup, joinGroup, getMemberRole } from '../../src/groups/index.js'
import { createThread, createReply, addReaction } from '../../src/posts/index.js'
import { awardPoints, getLeaderboard, calculateTier } from '../../src/points/index.js'
import { sendNotification, getPreferences } from '../../src/notifications/index.js'
import { followUser, isFollowing } from '../../src/follows/index.js'

const SUPABASE_URL = process.env['SUPABASE_URL']

const USER_ALPHA = '00000000-0000-0000-0000-000000000080'
const USER_BETA = '00000000-0000-0000-0000-000000000081'

describe('E2E: Full community flow', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL) return
    const admin = getSupabaseAdmin()

    // Seed users (simulating post-signup trigger result)
    await admin.from('profiles').upsert([
      {
        id: USER_ALPHA,
        username: 'e2e_alpha',
        display_name: 'E2E Alpha',
        tier: 'member',
        lifetime_points: 0,
      },
      {
        id: USER_BETA,
        username: 'e2e_beta',
        display_name: 'E2E Beta',
        tier: 'member',
        lifetime_points: 0,
      },
    ])

    // Reset ledger for clean state
    await admin.from('points_ledger').delete().in('user_id', [USER_ALPHA, USER_BETA])
    await admin.from('profiles').update({ lifetime_points: 0, tier: 'member' }).in('id', [USER_ALPHA, USER_BETA])
  })

  it('Step 1: profile update', async () => {
    if (!SUPABASE_URL) return
    const updated = await updateProfile(USER_ALPHA, {
      bio: 'Poker enthusiast from Austin',
      location_state: 'Texas',
      location_city: 'Austin',
    })
    expect(updated?.bio).toBe('Poker enthusiast from Austin')
    expect(updated?.location_city).toBe('Austin')
  })

  it('Step 2: create group and join', async () => {
    if (!SUPABASE_URL) return
    const group = await createGroup(USER_ALPHA, {
      name: 'E2E Poker Club',
      slug: `e2e-poker-club-${Date.now()}`,
      tier_level: 'city',
      privacy: 'public',
    })
    expect(group).not.toBeNull()

    const hostRole = await getMemberRole(USER_ALPHA, group!.id)
    expect(hostRole).toBe('host')

    const membership = await joinGroup(USER_BETA, group!.id)
    expect(membership).not.toBeNull()

    const memberRole = await getMemberRole(USER_BETA, group!.id)
    expect(memberRole).toBe('member')

    // Cleanup
    const admin = getSupabaseAdmin()
    await admin.from('group_memberships').delete().eq('group_id', group!.id)
    await admin.from('groups').delete().eq('id', group!.id)
  })

  it('Step 3: create thread and reply', async () => {
    if (!SUPABASE_URL) return
    const thread = await createThread(USER_ALPHA, {
      title: 'E2E Test Thread',
      body_md: '# Hand Analysis\nI had pocket aces...',
      tags: ['hand-analysis'],
    })
    expect(thread).not.toBeNull()

    const reply = await createReply(USER_BETA, {
      thread_id: thread!.id,
      body_md: 'Great play!',
    })
    expect(reply).not.toBeNull()
    expect(reply?.thread_id).toBe(thread!.id)

    // Cleanup
    const admin = getSupabaseAdmin()
    await admin.from('replies').delete().eq('thread_id', thread!.id)
    await admin.from('threads').delete().eq('id', thread!.id)
  })

  it('Step 4: react to content', async () => {
    if (!SUPABASE_URL) return
    const thread = await createThread(USER_ALPHA, {
      title: 'E2E React Thread',
      body_md: 'Content for reactions',
    })
    expect(thread).not.toBeNull()

    const reaction = await addReaction(USER_BETA, 'thread', thread!.id, '🃏')
    expect(reaction?.emoji).toBe('🃏')

    const admin = getSupabaseAdmin()
    await admin.from('reactions').delete().eq('target_id', thread!.id)
    await admin.from('threads').delete().eq('id', thread!.id)
  })

  it('Step 5: award points and check leaderboard', async () => {
    if (!SUPABASE_URL) return
    await awardPoints(USER_ALPHA, 'post_created', 10)
    await awardPoints(USER_ALPHA, 'reply_received', 5)
    await awardPoints(USER_BETA, 'post_created', 8)

    const admin = getSupabaseAdmin()
    const { data: alphaProfile } = await admin
      .from('profiles')
      .select('lifetime_points')
      .eq('id', USER_ALPHA)
      .single()

    expect((alphaProfile as { lifetime_points: number }).lifetime_points).toBeGreaterThanOrEqual(15)

    const leaderboard = await getLeaderboard(50)
    expect(leaderboard.length).toBeGreaterThan(0)

    for (let i = 1; i < leaderboard.length; i++) {
      const prev = leaderboard[i - 1]
      const curr = leaderboard[i]
      if (prev && curr) {
        expect(prev.lifetime_points).toBeGreaterThanOrEqual(curr.lifetime_points)
      }
    }
  })

  it('Step 6: tier calculation is consistent with points', async () => {
    expect(calculateTier(0)).toBe('member')
    expect(calculateTier(100)).toBe('contributor')
    expect(calculateTier(500)).toBe('trusted')
    expect(calculateTier(2000)).toBe('moderator')
    expect(calculateTier(10000)).toBe('admin')
  })

  it('Step 7: send notification', async () => {
    if (!SUPABASE_URL) return
    const notif = await sendNotification(
      USER_BETA,
      'new_reply',
      'Alpha replied to your thread',
      'Check the latest reply',
      '/threads/test',
    )
    expect(notif).not.toBeNull()
    expect(notif?.is_read).toBe(false)

    const admin = getSupabaseAdmin()
    await admin.from('delivered_notifications').delete().eq('id', notif!.id)
  })

  it('Step 8: notification preferences default to in_app', async () => {
    if (!SUPABASE_URL) return
    const prefs = await getPreferences(USER_ALPHA)
    expect(prefs.channels).toContain('in_app')
    expect(prefs.new_reply).toBe(true)
  })

  it('Step 9: follow user', async () => {
    if (!SUPABASE_URL) return
    const rel = await followUser(USER_ALPHA, USER_BETA)
    expect(rel).not.toBeNull()

    const following = await isFollowing(USER_ALPHA, USER_BETA)
    expect(following).toBe(true)

    const admin = getSupabaseAdmin()
    await admin
      .from('user_relationships')
      .delete()
      .eq('follower_id', USER_ALPHA)
      .eq('following_id', USER_BETA)
  })

  it('Step 10: read profile matches seeded data', async () => {
    if (!SUPABASE_URL) return
    const profile = await getProfile(USER_ALPHA)
    expect(profile).not.toBeNull()
    expect(profile?.username).toBe('e2e_alpha')
  })
})
