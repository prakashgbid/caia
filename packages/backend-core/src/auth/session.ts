import { getSupabaseClient } from '../client.js'
import type { SessionData } from '../types.js'

// Server-side auth validation: always requires the JWT from the request header.
// getSession() without a token is not viable server-side — persistSession:false means
// sb.auth.getSession() always returns null (no browser cookie/storage available).
export async function getUserFromToken(
  accessToken: string,
): Promise<SessionData> {
  if (!accessToken?.trim()) {
    return { userId: null, email: null, error: 'Invalid token' }
  }
  const sb = getSupabaseClient()
  try {
    const { data, error } = await sb.auth.getUser(accessToken)
    return {
      userId: data.user?.id ?? null,
      email: data.user?.email ?? null,
      error: error?.message ?? null,
    }
  } catch (err) {
    return { userId: null, email: null, error: (err as Error).message }
  }
}
