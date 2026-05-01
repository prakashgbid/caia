import { getSupabaseClient } from '../client.js'
import type { AuthResult } from '../types.js'

export async function signUpWithEmail(
  email: string,
  password: string,
  username?: string,
): Promise<AuthResult> {
  const sb = getSupabaseClient()
  try {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: username ? { data: { username } } : {},
    })
    if (error) {
      return { user: null, session: null, error: error.message }
    }
    if (!data.user) {
      return { user: null, session: null, error: 'user record not found' }
    }
    if (!data.user.email) {
      return { user: null, session: null, error: 'user record has no email' }
    }
    if (!data.session) {
      return {
        user: { id: data.user.id, email: data.user.email },
        session: null,
        error: 'email confirmation pending',
      }
    }
    return {
      user: { id: data.user.id, email: data.user.email },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
      error: null,
    }
  } catch (err) {
    return { user: null, session: null, error: (err as Error).message }
  }
}
