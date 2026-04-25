import { getSupabaseClient } from '../client.js'
import type { SessionData } from '../types.js'

export async function getSession(): Promise<SessionData> {
  const sb = getSupabaseClient()
  const { data } = await sb.auth.getSession()
  return {
    userId: data.session?.user.id ?? null,
    email: data.session?.user.email ?? null,
  }
}

export async function getUserFromToken(
  accessToken: string,
): Promise<{ userId: string | null; email: string | null; error: string | null }> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.auth.getUser(accessToken)
  return {
    userId: data.user?.id ?? null,
    email: data.user?.email ?? null,
    error: error?.message ?? null,
  }
}
