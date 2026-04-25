import { getSupabaseClient } from '../client.js'
import type { Group, GroupTier, PaginationParams, PaginatedResult } from '../types.js'

export async function getGroup(groupId: string): Promise<Group | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single()

  if (error ?? !data) return null
  return data as Group
}

export async function getGroupBySlug(slug: string): Promise<Group | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('groups')
    .select('*')
    .ilike('slug', slug)
    .single()

  if (error ?? !data) return null
  return data as Group
}

export async function listGroups(
  filter: { tier?: GroupTier; parentId?: string } = {},
  params: PaginationParams = {},
): Promise<PaginatedResult<Group>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  let query = sb
    .from('groups')
    .select('*', { count: 'exact' })
    .range(offset, offset + limit - 1)
    .order('member_count', { ascending: false })

  if (filter.tier) {
    query = query.eq('tier_level', filter.tier)
  }

  if (filter.parentId) {
    query = query.eq('parent_group_id', filter.parentId)
  }

  const { data, error, count } = await query

  if (error) return { data: [], total: 0, hasMore: false }

  const total = count ?? 0
  return {
    data: (data ?? []) as Group[],
    total,
    hasMore: offset + limit < total,
  }
}

export async function listUserGroups(
  userId: string,
  params: PaginationParams = {},
): Promise<PaginatedResult<Group>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  const { data, error, count } = await sb
    .from('group_memberships')
    .select('group:groups(*)', { count: 'exact' })
    .eq('user_id', userId)
    .range(offset, offset + limit - 1)
    .order('joined_at', { ascending: false })

  if (error) return { data: [], total: 0, hasMore: false }

  const groups = (data ?? [])
    .map((row) => (row as unknown as { group: Group }).group)
    .filter(Boolean)

  const total = count ?? 0
  return {
    data: groups,
    total,
    hasMore: offset + limit < total,
  }
}

export async function listGroupsByArea(
  state: string,
  city?: string,
  params: PaginationParams = {},
): Promise<PaginatedResult<Group>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  // Find user IDs in that state/city, then find their groups
  let profileQuery = sb.from('profiles').select('id').ilike('location_state', state)

  if (city) {
    profileQuery = profileQuery.ilike('location_city', city)
  }

  const { data: profiles } = await profileQuery

  if (!profiles || profiles.length === 0) {
    return { data: [], total: 0, hasMore: false }
  }

  const userIds = profiles.map((p: { id: string }) => p.id)

  const { data: memberships } = await sb
    .from('group_memberships')
    .select('group_id')
    .in('user_id', userIds)

  if (!memberships || memberships.length === 0) {
    return { data: [], total: 0, hasMore: false }
  }

  const groupIds = [...new Set(memberships.map((m: { group_id: string }) => m.group_id))]

  const { data, error, count } = await sb
    .from('groups')
    .select('*', { count: 'exact' })
    .in('id', groupIds)
    .eq('privacy', 'public')
    .range(offset, offset + limit - 1)
    .order('member_count', { ascending: false })

  if (error) return { data: [], total: 0, hasMore: false }

  const total = count ?? 0
  return {
    data: (data ?? []) as Group[],
    total,
    hasMore: offset + limit < total,
  }
}
