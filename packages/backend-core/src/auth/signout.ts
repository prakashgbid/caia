import { getSupabaseClient } from '../client.js'

export async function signOut(): Promise<{ error: string | null }> {
  const sb = getSupabaseClient()
  const { error } = await sb.auth.signOut()
  return { error: error?.message ?? null }
}
