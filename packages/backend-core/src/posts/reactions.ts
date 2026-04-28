import { getSupabaseClient } from '../client.js'
import type { Reaction } from '../types.js'

export async function addReaction(
  userId: string,
  targetType: 'thread' | 'reply' | 'article',
  targetId: string,
  emoji: string,
): Promise<Reaction | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('reactions')
    .upsert(
      { user_id: userId, target_type: targetType, target_id: targetId, emoji },
      { onConflict: 'user_id,target_type,target_id,emoji' },
    )
    .select()
    .single()

  if (error ?? !data) return null
  return data as Reaction
}

export async function removeReaction(
  userId: string,
  targetType: 'thread' | 'reply' | 'article',
  targetId: string,
  emoji: string,
): Promise<boolean> {
  const sb = getSupabaseClient()
  const { error } = await sb
    .from('reactions')
    .delete()
    .eq('user_id', userId)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('emoji', emoji)

  return !error
}

export async function getReactions(
  targetType: 'thread' | 'reply' | 'article',
  targetId: string,
): Promise<Reaction[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('reactions')
    .select('*')
    .eq('target_type', targetType)
    .eq('target_id', targetId)

  if (error) return []
  return (data ?? []) as Reaction[]
}
