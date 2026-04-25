import { getSupabaseClient } from '../client.js'
import type { AuthResult } from '../types.js'

export async function signUpWithEmail(
  email: string,
  password: string,
  username?: string,
): Promise<AuthResult> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: username ? { data: { username } } : {},
  })
  return {
    user: data.user ? { id: data.user.id, email: data.user.email ?? email } : null,
    session: data.session
      ? {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }
      : null,
    error: error?.message ?? null,
  }
}
