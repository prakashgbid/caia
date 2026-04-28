import { getSupabaseAdmin, getSupabaseClient } from '../client.js'
import type { UserTier, Profile } from '../types.js'

export const POINTS_THRESHOLDS: Record<UserTier, number> = {
  member: 0,
  contributor: 100,
  trusted: 500,
  moderator: 2000,
  admin: 10000,
}

export function calculateTier(points: number): UserTier {
  if (points >= POINTS_THRESHOLDS.admin) return 'admin'
  if (points >= POINTS_THRESHOLDS.moderator) return 'moderator'
  if (points >= POINTS_THRESHOLDS.trusted) return 'trusted'
  if (points >= POINTS_THRESHOLDS.contributor) return 'contributor'
  return 'member'
}

export async function checkAndPromote(userId: string): Promise<boolean> {
  const admin = getSupabaseAdmin()

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('tier, lifetime_points')
    .eq('id', userId)
    .single()

  if (profileError ?? !profile) return false

  const currentTier = (profile as { tier: UserTier; lifetime_points: number }).tier
  const points = (profile as { tier: UserTier; lifetime_points: number }).lifetime_points
  const newTier = calculateTier(points)

  if (newTier === currentTier) return false

  const { error: updateError } = await admin
    .from('profiles')
    .update({ tier: newTier })
    .eq('id', userId)

  if (updateError) return false

  await admin.from('tier_promotions').insert({
    user_id: userId,
    from_tier: currentTier,
    to_tier: newTier,
    points_at_promotion: points,
  })

  return true
}

export async function getLeaderboard(limit = 50, offset = 0): Promise<Profile[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .order('lifetime_points', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return []
  return (data ?? []) as Profile[]
}
