import { getSupabaseClient } from '../client.js'

export async function sendMagicLink(
  email: string,
  redirectTo: string,
): Promise<{ error: string | null }> {
  const sb = getSupabaseClient()
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  })
  return { error: error?.message ?? null }
}
