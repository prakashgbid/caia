import { getSupabaseClient } from '../client.js'
import type { Reply, CreateReplyInput, PaginationParams, PaginatedResult } from '../types.js'

export async function createReply(
  userId: string,
  input: CreateReplyInput,
): Promise<Reply | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('replies')
    .insert({
      thread_id: input.thread_id,
      parent_reply_id: input.parent_reply_id ?? null,
      author_id: userId,
      body_md: input.body_md,
    })
    .select()
    .single()

  if (error ?? !data) return null
  return data as Reply
}

export async function listReplies(
  threadId: string,
  params: PaginationParams = {},
): Promise<PaginatedResult<Reply>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 100
  const offset = params.offset ?? 0

  const { data, error, count } = await sb
    .from('replies')
    .select('*', { count: 'exact' })
    .eq('thread_id', threadId)
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: true })

  if (error) return { data: [], total: 0, hasMore: false }

  const total = count ?? 0
  return {
    data: (data ?? []) as Reply[],
    total,
    hasMore: offset + limit < total,
  }
}

export async function deleteReply(replyId: string, userId: string): Promise<boolean> {
  const sb = getSupabaseClient()
  const { error } = await sb
    .from('replies')
    .update({ body_md: '[deleted]' })
    .eq('id', replyId)
    .eq('author_id', userId)

  return !error
}
