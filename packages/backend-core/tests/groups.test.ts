import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createGroup, joinGroup, leaveGroup, getMemberRole, listUserGroups } from '../src/groups/index.js'
import { getSupabaseAdmin } from '../src/client.js'

const SUPABASE_URL = process.env['SUPABASE_URL']

const USER_A = '00000000-0000-0000-0000-000000000010'
const USER_B = '00000000-0000-0000-0000-000000000011'

const createdGroupIds: string[] = []

describe('groups', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL) return
    const admin = getSupabaseAdmin()
    await admin.from('profiles').upsert([
      { id: USER_A, username: 'group_user_a', display_name: 'Group User A', tier: 'member', lifetime_points: 0 },
      { id: USER_B, username: 'group_user_b', display_name: 'Group User B', tier: 'member', lifetime_points: 0 },
    ])
  })

  afterEach(async () => {
    if (!SUPABASE_URL || createdGroupIds.length === 0) return
    const admin = getSupabaseAdmin()
    await admin.from('groups').delete().in('id', createdGroupIds)
    createdGroupIds.length = 0
  })

  it('createGroup auto-joins creator as host', async () => {
    if (!SUPABASE_URL) return
    const group = await createGroup(USER_A, {
      name: 'Test Poker Club',
      slug: `test-poker-club-${Date.now()}`,
      tier_level: 'city',
      privacy: 'public',
    })
    expect(group).not.toBeNull()
    createdGroupIds.push(group!.id)

    const role = await getMemberRole(USER_A, group!.id)
    expect(role).toBe('host')
  })

  it('joinGroup adds user as member', async () => {
    if (!SUPABASE_URL) return
    const group = await createGroup(USER_A, {
      name: 'Join Test Group',
      slug: `join-test-${Date.now()}`,
      tier_level: 'neighborhood',
      privacy: 'public',
    })
    createdGroupIds.push(group!.id)

    const membership = await joinGroup(USER_B, group!.id)
    expect(membership).not.toBeNull()
    expect(membership?.role).toBe('member')

    const admin = getSupabaseAdmin()
    await admin.from('group_memberships').delete().eq('user_id', USER_B).eq('group_id', group!.id)
  })

  it('leaveGroup removes membership', async () => {
    if (!SUPABASE_URL) return
    const group = await createGroup(USER_A, {
      name: 'Leave Test Group',
      slug: `leave-test-${Date.now()}`,
      tier_level: 'city',
      privacy: 'public',
    })
    createdGroupIds.push(group!.id)

    await joinGroup(USER_B, group!.id)
    const left = await leaveGroup(USER_B, group!.id)
    expect(left).toBe(true)

    const role = await getMemberRole(USER_B, group!.id)
    expect(role).toBeNull()
  })

  it('getMemberRole returns null for non-member', async () => {
    if (!SUPABASE_URL) return
    const group = await createGroup(USER_A, {
      name: 'Role Test Group',
      slug: `role-test-${Date.now()}`,
      tier_level: 'city',
      privacy: 'public',
    })
    createdGroupIds.push(group!.id)

    const role = await getMemberRole(USER_B, group!.id)
    expect(role).toBeNull()
  })

  it('listUserGroups returns groups user belongs to', async () => {
    if (!SUPABASE_URL) return
    const group = await createGroup(USER_A, {
      name: 'List Test Group',
      slug: `list-test-${Date.now()}`,
      tier_level: 'state',
      privacy: 'public',
    })
    createdGroupIds.push(group!.id)

    const result = await listUserGroups(USER_A)
    expect(result.data.length).toBeGreaterThan(0)
    const found = result.data.find((g) => g.id === group!.id)
    expect(found).toBeDefined()
  })
})
