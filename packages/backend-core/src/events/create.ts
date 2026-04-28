import { getSupabaseClient } from '../client.js'
import type { Event, CreateEventInput, UpdateEventInput, PaginationParams, PaginatedResult, EventKind } from '../types.js'

export async function createEvent(
  userId: string,
  input: CreateEventInput,
): Promise<Event | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('events')
    .insert({
      group_id: input.group_id ?? null,
      created_by: userId,
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      location_text: input.location_text ?? null,
      location_lat: input.location_lat ?? null,
      location_lng: input.location_lng ?? null,
      capacity: input.capacity ?? null,
    })
    .select()
    .single()

  if (error ?? !data) return null
  return data as Event
}

export async function updateEvent(
  eventId: string,
  userId: string,
  input: UpdateEventInput,
): Promise<Event | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('events')
    .update(input)
    .eq('id', eventId)
    .eq('created_by', userId)
    .select()
    .single()

  if (error ?? !data) return null
  return data as Event
}

export async function cancelEvent(eventId: string, userId: string): Promise<boolean> {
  const sb = getSupabaseClient()
  const { error } = await sb
    .from('events')
    .update({ is_cancelled: true })
    .eq('id', eventId)
    .eq('created_by', userId)

  return !error
}

export async function getEvent(eventId: string): Promise<Event | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single()

  if (error ?? !data) return null
  return data as Event
}

export async function listEvents(
  filter: { groupId?: string; kind?: EventKind; upcoming?: boolean } = {},
  params: PaginationParams = {},
): Promise<PaginatedResult<Event>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  let query = sb
    .from('events')
    .select('*', { count: 'exact' })
    .eq('is_cancelled', false)
    .range(offset, offset + limit - 1)
    .order('starts_at', { ascending: true })

  if (filter.groupId) {
    query = query.eq('group_id', filter.groupId)
  }

  if (filter.kind) {
    query = query.eq('kind', filter.kind)
  }

  if (filter.upcoming) {
    query = query.gte('starts_at', new Date().toISOString())
  }

  const { data, error, count } = await query

  if (error) return { data: [], total: 0, hasMore: false }

  const total = count ?? 0
  return {
    data: (data ?? []) as Event[],
    total,
    hasMore: offset + limit < total,
  }
}
