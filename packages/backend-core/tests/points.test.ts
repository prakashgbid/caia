import { describe, it, expect, beforeAll } from 'vitest'
import { awardPoints, getLeaderboard, calculateTier, POINTS_THRESHOLDS } from '../src/points/index.js'
import { getSupabaseAdmin } from '../src/client.js'

const SUPABASE_URL = process.env['SUPABASE_URL']
const USER_ID = '00000000-0000-0000-0000-000000000050'

describe('points', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL) return
    const admin = getSupabaseAdmin()
    await admin.from('profiles').upsert({
      id: USER_ID,
      username: 'points_user',
      display_name: 'Points User',
      tier: 'member',
      lifetime_points: 0,
    })
    // Clean any prior ledger entries
    await admin.from('points_ledger').delete().eq('user_id', USER_ID)
    await admin.from('profiles').update({ lifetime_points: 0 }).eq('id', USER_ID)
  })

  it('awardPoints inserts a ledger record', async () => {
    if (!SUPABASE_URL) return
    const entry = await awardPoints(USER_ID, 'test_award', 50)
    expect(entry).not.toBeNull()
    expect(entry?.delta).toBe(50)
    expect(entry?.reason).toBe('test_award')
  })

  it('awardPoints updates profile lifetime_points via trigger', async () => {
    if (!SUPABASE_URL) return
    await awardPoints(USER_ID, 'another_award', 25)

    const admin = getSupabaseAdmin()
    const { data } = await admin.from('profiles').select('lifetime_points').eq('id', USER_ID).single()
    // After two awards (50 + 25) lifetime_points should be >= 75
    expect((data as { lifetime_points: number }).lifetime_points).toBeGreaterThanOrEqual(75)
  })

  it('calculateTier returns correct tier for given points', () => {
    expect(calculateTier(0)).toBe('member')
    expect(calculateTier(POINTS_THRESHOLDS.contributor)).toBe('contributor')
    expect(calculateTier(POINTS_THRESHOLDS.trusted)).toBe('trusted')
    expect(calculateTier(POINTS_THRESHOLDS.moderator)).toBe('moderator')
    expect(calculateTier(POINTS_THRESHOLDS.admin)).toBe('admin')
    expect(calculateTier(999999)).toBe('admin')
  })

  it('getLeaderboard returns profiles sorted by points descending', async () => {
    if (!SUPABASE_URL) return
    const leaderboard = await getLeaderboard(10)
    expect(Array.isArray(leaderboard)).toBe(true)

    for (let i = 1; i < leaderboard.length; i++) {
      const prev = leaderboard[i - 1]
      const curr = leaderboard[i]
      if (prev && curr) {
        expect(prev.lifetime_points).toBeGreaterThanOrEqual(curr.lifetime_points)
      }
    }
  })

  it('awardPoints throws for non-positive delta', () => {
    expect(() => awardPoints(USER_ID, 'bad', 0)).toThrow()
    expect(() => awardPoints(USER_ID, 'bad', -10)).toThrow()
  })
})
