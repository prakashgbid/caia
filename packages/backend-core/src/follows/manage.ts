import { getSupabaseClient } from '../client.js'
import type { UserRelationship, Profile, PaginationParams, PaginatedResult } from '../types.js'

async function upsertRelationship(
  followerId: string,
  followingId: string,
  kind: 'follow' | 'mute' | 'block',
): Promise<UserRelationship | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('user_relationships')
    .upsert(
      { follower_id: followerId, following_id: followingId, kind },
      { onConflict: 'follower_id,following_id,kind' },
    )
    .select()
    .single()

  if (error ?? !data) return null
  return data as UserRelationship
}

async function deleteRelationship(
  followerId: string,
  followingId: string,
  kind: 'follow' | 'mute' | 'block',
): Promise<boolean> {
  const sb = getSupabaseClient()
  const { error } = await sb
    .from('user_relationships')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .eq('kind', kind)

  return !error
}

async function relationshipExists(
  followerId: string,
  followingId: string,
  kind: 'follow' | 'mute' | 'block',
): Promise<boolean> {
  const sb = getSupabaseClient()
  const { count, error } = await sb
    .from('user_relationships')
    .select('*', { count: 'exact', head: true })
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .eq('kind', kind)

  if (error) return false
  return (count ?? 0) > 0
}

export async function followUser(
  followerId: string,
  followingId: string,
): Promise<UserRelationship | null> {
  return upsertRelationship(followerId, followingId, 'follow')
}

export async function unfollowUser(followerId: string, followingId: string): Promise<boolean> {
  return deleteRelationship(followerId, followingId, 'follow')
}

export async function muteUser(
  userId: string,
  targetId: string,
): Promise<UserRelationship | null> {
  return upsertRelationship(userId, targetId, 'mute')
}

export async function blockUser(
  userId: string,
  targetId: string,
): Promise<UserRelationship | null> {
  return upsertRelationship(userId, targetId, 'block')
}

export async function getFollowers(
  userId: string,
  params: PaginationParams = {},
): Promise<PaginatedResult<UserRelationship & { profile: Profile }>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  const { data, error, count } = await sb
    .from('user_relationships')
    .select('*, profile:profiles!follower_id(*)', { count: 'exact' })
    .eq('following_id', userId)
    .eq('kind', 'follow')
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })

  if (error) return { data: [], total: 0, hasMore: false }

  const total = count ?? 0
  return {
    data: (data ?? []) as unknown as (UserRelationship & { profile: Profile })[],
    total,
    hasMore: offset + limit < total,
  }
}

export async function getFollowing(
  userId: string,
  params: PaginationParams = {},
): Promise<PaginatedResult<UserRelationship & { profile: Profile }>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  const { data, error, count } = await sb
    .from('user_relationships')
    .select('*, profile:profiles!following_id(*)', { count: 'exact' })
    .eq('follower_id', userId)
    .eq('kind', 'follow')
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })

  if (error) return { data: [], total: 0, hasMore: false }

  const total = count ?? 0
  return {
    data: (data ?? []) as unknown as (UserRelationship & { profile: Profile })[],
    total,
    hasMore: offset + limit < total,
  }
}

export async function isFollowing(followerId: string, followingId: string): Promise<boolean> {
  return relationshipExists(followerId, followingId, 'follow')
}

export async function isMuted(userId: string, targetId: string): Promise<boolean> {
  return relationshipExists(userId, targetId, 'mute')
}

export async function isBlocked(userId: string, targetId: string): Promise<boolean> {
  return relationshipExists(userId, targetId, 'block')
}
