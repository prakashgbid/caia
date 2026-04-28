import { getSupabaseAdmin } from '../client.js'
import type { PointsLedger, Json, PaginationParams, PaginatedResult } from '../types.js'

export async function awardPoints(
  userId: string,
  reason: string,
  delta: number,
  metadata?: Json,
): Promise<PointsLedger | null> {
  if (delta <= 0) throw new Error('delta must be positive for award. Use deductPoints for negative amounts.')
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('points_ledger')
    .insert({
      user_id: userId,
      reason,
      delta,
      metadata: metadata ?? null,
    })
    .select()
    .single()

  if (error ?? !data) return null
  return data as PointsLedger
}

export async function deductPoints(
  userId: string,
  reason: string,
  delta: number,
  metadata?: Json,
): Promise<PointsLedger | null> {
  if (delta <= 0) throw new Error('delta must be positive — it will be stored as negative deduction.')
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('points_ledger')
    .insert({
      user_id: userId,
      reason,
      delta: -delta,
      metadata: metadata ?? null,
    })
    .select()
    .single()

  if (error ?? !data) return null
  return data as PointsLedger
}

export async function getPointsHistory(
  userId: string,
  params: PaginationParams = {},
): Promise<PaginatedResult<PointsLedger>> {
  const sb = getSupabaseAdmin()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  const { data, error, count } = await sb
    .from('points_ledger')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })

  if (error) return { data: [], total: 0, hasMore: false }

  const total = count ?? 0
  return {
    data: (data ?? []) as PointsLedger[],
    total,
    hasMore: offset + limit < total,
  }
}
