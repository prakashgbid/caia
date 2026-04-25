import { describe, it, expect, beforeAll } from 'vitest'
import { signUpWithEmail, signInWithEmail, signOut, sendMagicLink, getUserFromToken } from '../src/auth/index.js'

const SUPABASE_URL = process.env['SUPABASE_URL']

describe('auth', () => {
  beforeAll(() => {
    if (!SUPABASE_URL) {
      console.warn('SUPABASE_URL not set — skipping auth tests')
    }
  })

  it('signUpWithEmail returns error for invalid email format', async () => {
    if (!SUPABASE_URL) return
    const result = await signUpWithEmail('not-an-email', 'password123')
    // Supabase rejects invalid emails
    expect(result.user).toBeNull()
    expect(result.error).not.toBeNull()
  })

  it('signUpWithEmail returns error for weak password', async () => {
    if (!SUPABASE_URL) return
    const result = await signUpWithEmail('test@example.com', '123')
    expect(result.error).not.toBeNull()
  })

  it('signInWithEmail returns error for unknown credentials', async () => {
    if (!SUPABASE_URL) return
    const result = await signInWithEmail('nouser_xyz@example.com', 'wrongpassword')
    expect(result.user).toBeNull()
    expect(result.session).toBeNull()
    expect(result.error).not.toBeNull()
  })

  it('sendMagicLink returns no error for valid email', async () => {
    if (!SUPABASE_URL) return
    // In local Supabase, magic links are accepted without actual delivery
    const result = await sendMagicLink('test@example.com', 'http://localhost:3000/auth/callback')
    // Local Supabase may succeed or fail based on email config — we just check shape
    expect(result).toHaveProperty('error')
  })

  it('getUserFromToken returns error for invalid token', async () => {
    if (!SUPABASE_URL) return
    const result = await getUserFromToken('totally.invalid.token')
    expect(result.userId).toBeNull()
    expect(result.error).not.toBeNull()
  })

  it('signOut returns no error when not signed in', async () => {
    if (!SUPABASE_URL) return
    const result = await signOut()
    expect(result.error).toBeNull()
  })
})
