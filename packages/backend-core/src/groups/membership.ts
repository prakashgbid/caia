import { getSupabaseClient } from '../client.js'
import type { GroupMembership, MemberRole, Profile, PaginationParams, PaginatedResult } from '../types.js'

export async function joinGroup(userId: string, groupId: string): Promise<GroupMembership | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('group_memberships')
    .insert({ group_id: groupId, user_id: userId, role: 'member' })
    .select()
    .single()

  if (error ?? !data) return null
  return data as GroupMembership
}

export async function leaveGroup(userId: string, groupId: string): Promise<boolean> {
  const sb = getSupabaseClient()
  const { error } = await sb
    .from('group_memberships')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId)

  return !error
}

export async function getGroupMembers(
  groupId: string,
  params: PaginationParams = {},
): Promise<PaginatedResult<GroupMembership & { profile: Profile }>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  const { data, error, count } = await sb
    .from('group_memberships')
    .select('*, profile:profiles(*)', { count: 'exact' })
    .eq('group_id', groupId)
    .range(offset, offset + limit - 1)
    .order('joined_at', { ascending: true })

  if (error) return { data: [], total: 0, hasMore: false }

  const total = count ?? 0
  return {
    data: (data ?? []) as unknown as (GroupMembership & { profile: Profile })[],
    total,
    hasMore: offset + limit < total,
  }
}

export async function getMemberRole(
  userId: string,
  groupId: string,
): Promise<MemberRole | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('group_memberships')
    .select('role')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .single()

  if (error ?? !data) return null
  return (data as { role: MemberRole }).role
}

export async function updateMemberRole(
  groupId: string,
  targetUserId: string,
  newRole: MemberRole,
  requestingUserId: string,
): Promise<boolean> {
  const sb = getSupabaseClient()

  // Verify requesting user has permission
  const requesterRole = await getMemberRole(requestingUserId, groupId)
  if (!requesterRole || (requesterRole !== 'host' && requesterRole !== 'moderator')) {
    return false
  }

  // Moderators cannot promote to host
  if (requesterRole === 'moderator' && newRole === 'host') {
    return false
  }

  const { error } = await sb
    .from('group_memberships')
    .update({ role: newRole })
    .eq('group_id', groupId)
    .eq('user_id', targetUserId)

  return !error
}
