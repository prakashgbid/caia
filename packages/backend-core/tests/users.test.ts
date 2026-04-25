import { describe, it, expect, beforeAll } from 'vitest'
import { getProfile, getProfileByUsername, searchProfiles } from '../src/users/index.js'
import { getSupabaseAdmin } from '../src/client.js'

const SUPABASE_URL = process.env['SUPABASE_URL']

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001'

describe('users', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL) return
    // Seed a test profile via admin client
    const admin = getSupabaseAdmin()
    await admin.from('profiles').upsert({
      id: TEST_USER_ID,
      username: 'testuser_users',
      display_name: 'Test User',
      tier: 'member',
      lifetime_points: 0,
    })
  })

  it('getProfile returns null for unknown id', async () => {
    if (!SUPABASE_URL) return
    const profile = await getProfile('00000000-0000-0000-0000-000000000000')
    expect(profile).toBeNull()
  })

  it('getProfile returns profile for known id', async () => {
    if (!SUPABASE_URL) return
    const profile = await getProfile(TEST_USER_ID)
    expect(profile).not.toBeNull()
    expect(profile?.username).toBe('testuser_users')
  })

  it('getProfileByUsername finds by exact username', async () => {
    if (!SUPABASE_URL) return
    const profile = await getProfileByUsername('testuser_users')
    expect(profile).not.toBeNull()
    expect(profile?.id).toBe(TEST_USER_ID)
  })

  it('getProfileByUsername returns null for missing username', async () => {
    if (!SUPABASE_URL) return
    const profile = await getProfileByUsername('definitelynotarealuser_xyzabc')
    expect(profile).toBeNull()
  })

  it('searchProfiles returns matching profiles', async () => {
    if (!SUPABASE_URL) return
    const results = await searchProfiles('testuser_users')
    expect(Array.isArray(results)).toBe(true)
    const found = results.find((p) => p.id === TEST_USER_ID)
    expect(found).toBeDefined()
  })

  it('searchProfiles returns empty array for no matches', async () => {
    if (!SUPABASE_URL) return
    const results = await searchProfiles('zzznomatch_xyzxyz_9999')
    expect(results).toEqual([])
  })
})
