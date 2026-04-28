import { getSupabaseClient } from '../client.js'

export type OAuthProvider = 'google' | 'github' | 'discord' | 'twitter'

export async function signInWithOAuth(
  provider: OAuthProvider,
  redirectTo: string,
): Promise<{ url: string | null; error: string | null }> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  })
  return { url: data.url ?? null, error: error?.message ?? null }
}
