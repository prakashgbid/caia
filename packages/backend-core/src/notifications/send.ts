import { getSupabaseAdmin } from '../client.js'
import type { DeliveredNotification, Json } from '../types.js'

export async function sendNotification(
  userId: string,
  kind: string,
  title: string,
  body?: string,
  actionUrl?: string,
  metadata?: Json,
): Promise<DeliveredNotification | null> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('delivered_notifications')
    .insert({
      user_id: userId,
      kind,
      title,
      body: body ?? null,
      action_url: actionUrl ?? null,
      metadata: metadata ?? null,
    })
    .select()
    .single()

  if (error ?? !data) return null
  return data as DeliveredNotification
}
