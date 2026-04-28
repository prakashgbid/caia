import { getSupabaseClient } from '../client.js'
import type { Thread, CreateThreadInput, UpdateThreadInput, PaginationParams, PaginatedResult } from '../types.js'

export async function createThread(
  userId: string,
  input: CreateThreadInput,
): Promise<Thread | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('threads')
    .insert({
      group_id: input.group_id ?? null,
      author_id: userId,
      title: input.title,
      body_md: input.body_md,
      tags: input.tags ?? [],
    })
    .select()
    .single()

  if (error ?? !data) return null
  return data as Thread
}

export async function getThread(threadId: string): Promise<Thread | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('threads')
    .select('*')
    .eq('id', threadId)
    .single()

  if (error ?? !data) return null
  return data as Thread
}

export async function listThreads(
  filter: { groupId?: string; tag?: string } = {},
  params: PaginationParams = {},
): Promise<PaginatedResult<Thread>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  let query = sb
    .from('threads')
    .select('*', { count: 'exact' })
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })

  if (filter.groupId) {
    query = query.eq('group_id', filter.groupId)
  }

  if (filter.tag) {
    query = query.contains('tags', [filter.tag])
  }

  const { data, error, count } = await query

  if (error) return { data: [], total: 0, hasMore: false }

  const total = count ?? 0
  return {
    data: (data ?? []) as Thread[],
    total,
    hasMore: offset + limit < total,
  }
}

export async function updateThread(
  threadId: string,
  userId: string,
  input: UpdateThreadInput,
): Promise<Thread | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('threads')
    .update(input)
    .eq('id', threadId)
    .eq('author_id', userId)
    .select()
    .single()

  if (error ?? !data) return null
  return data as Thread
}

export async function deleteThread(threadId: string, userId: string): Promise<boolean> {
  const sb = getSupabaseClient()
  // Soft delete by replacing content
  const { error } = await sb
    .from('threads')
    .update({ body_md: '[deleted]', title: '[deleted]', tags: [] })
    .eq('id', threadId)
    .eq('author_id', userId)

  return !error
}
