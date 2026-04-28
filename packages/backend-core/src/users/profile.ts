import { getSupabaseClient } from '../client.js'
import type { Profile, UpdateProfileInput, PaginationParams, PaginatedResult } from '../types.js'

export async function getProfile(userId: string): Promise<Profile | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error ?? !data) return null
  return data as Profile
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .ilike('username', username)
    .single()

  if (error ?? !data) return null
  return data as Profile
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<Profile | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('profiles')
    .update(input)
    .eq('id', userId)
    .select()
    .single()

  if (error ?? !data) return null
  return data as Profile
}

export async function listProfiles(params: PaginationParams = {}): Promise<PaginatedResult<Profile>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  const { data, error, count } = await sb
    .from('profiles')
    .select('*', { count: 'exact' })
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })

  if (error) return { data: [], total: 0, hasMore: false }

  const total = count ?? 0
  return {
    data: (data ?? []) as Profile[],
    total,
    hasMore: offset + limit < total,
  }
}

export async function searchProfiles(
  query: string,
  limit = 20,
): Promise<Profile[]> {
  const sb = getSupabaseClient()
  const pattern = `%${query}%`

  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
    .limit(limit)
    .order('lifetime_points', { ascending: false })

  if (error) return []
  return (data ?? []) as Profile[]
}
