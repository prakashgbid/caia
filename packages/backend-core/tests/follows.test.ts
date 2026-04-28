import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import {
  followUser,
  unfollowUser,
  isFollowing,
  muteUser,
  isMuted,
  blockUser,
  isBlocked,
} from '../src/follows/index.js'
import { getSupabaseAdmin } from '../src/client.js'

const SUPABASE_URL = process.env['SUPABASE_URL']

const USER_A = '00000000-0000-0000-0000-000000000070'
const USER_B = '00000000-0000-0000-0000-000000000071'
const USER_C = '00000000-0000-0000-0000-000000000072'

describe('follows', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL) return
    const admin = getSupabaseAdmin()
    await admin.from('profiles').upsert([
      { id: USER_A, username: 'follows_user_a', display_name: 'Follows A', tier: 'member', lifetime_points: 0 },
      { id: USER_B, username: 'follows_user_b', display_name: 'Follows B', tier: 'member', lifetime_points: 0 },
      { id: USER_C, username: 'follows_user_c', display_name: 'Follows C', tier: 'member', lifetime_points: 0 },
    ])
  })

  afterEach(async () => {
    if (!SUPABASE_URL) return
    const admin = getSupabaseAdmin()
    await admin
      .from('user_relationships')
      .delete()
      .in('follower_id', [USER_A, USER_B, USER_C])
  })

  it('followUser creates a follow relationship', async () => {
    if (!SUPABASE_URL) return
    const rel = await followUser(USER_A, USER_B)
    expect(rel).not.toBeNull()
    expect(rel?.kind).toBe('follow')
  })

  it('isFollowing returns true after following', async () => {
    if (!SUPABASE_URL) return
    await followUser(USER_A, USER_B)
    const result = await isFollowing(USER_A, USER_B)
    expect(result).toBe(true)
  })

  it('unfollowUser removes the follow relationship', async () => {
    if (!SUPABASE_URL) return
    await followUser(USER_A, USER_B)
    await unfollowUser(USER_A, USER_B)
    const result = await isFollowing(USER_A, USER_B)
    expect(result).toBe(false)
  })

  it('muteUser creates a mute relationship', async () => {
    if (!SUPABASE_URL) return
    const rel = await muteUser(USER_A, USER_C)
    expect(rel?.kind).toBe('mute')
    const result = await isMuted(USER_A, USER_C)
    expect(result).toBe(true)
  })

  it('blockUser creates a block relationship', async () => {
    if (!SUPABASE_URL) return
    const rel = await blockUser(USER_B, USER_C)
    expect(rel?.kind).toBe('block')
    const result = await isBlocked(USER_B, USER_C)
    expect(result).toBe(true)
  })

  it('isFollowing returns false when not following', async () => {
    if (!SUPABASE_URL) return
    const result = await isFollowing(USER_C, USER_A)
    expect(result).toBe(false)
  })
})
