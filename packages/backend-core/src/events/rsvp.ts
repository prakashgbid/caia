import { getSupabaseClient } from '../client.js'
import type { Rsvp, RsvpStatus, Profile, PaginationParams, PaginatedResult } from '../types.js'

export async function rsvp(
  userId: string,
  eventId: string,
  status: RsvpStatus,
): Promise<Rsvp | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('rsvps')
    .upsert(
      { user_id: userId, event_id: eventId, status },
      { onConflict: 'event_id,user_id' },
    )
    .select()
    .single()

  if (error ?? !data) return null
  return data as Rsvp
}

export async function getRsvp(userId: string, eventId: string): Promise<Rsvp | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('rsvps')
    .select('*')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .single()

  if (error ?? !data) return null
  return data as Rsvp
}

export async function listEventRsvps(
  eventId: string,
  status?: RsvpStatus,
  params: PaginationParams = {},
): Promise<PaginatedResult<Rsvp & { profile: Profile }>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  let query = sb
    .from('rsvps')
    .select('*, profile:profiles(*)', { count: 'exact' })
    .eq('event_id', eventId)
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: true })

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error, count } = await query

  if (error) return { data: [], total: 0, hasMore: false }

  const total = count ?? 0
  return {
    data: (data ?? []) as unknown as (Rsvp & { profile: Profile })[],
    total,
    hasMore: offset + limit < total,
  }
}
