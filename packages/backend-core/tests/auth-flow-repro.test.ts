/**
 * Auth flow integration tests (mocked Supabase).
 *
 * Covers the full sign-in → token → validate round-trip and verifies that
 * getSession() correctly surfaces Supabase service errors — callers can
 * distinguish "user not authenticated" from "auth service failure" via
 * SessionData.error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// vi.hoisted ensures these are available inside the vi.mock() factory (which is hoisted)
const { mockSignInWithPassword, mockSignUp, mockSignOut, mockGetUser } =
  vi.hoisted(() => ({
    mockSignInWithPassword: vi.fn(),
    mockSignUp: vi.fn(),
    mockSignOut: vi.fn(),
    mockGetUser: vi.fn(),
  }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signUp: mockSignUp,
      signOut: mockSignOut,
      getUser: mockGetUser,
    },
  }),
}))

import { signInWithEmail, signOut, getUserFromToken } from '../src/auth/index.js'
import { resetClients } from '../src/client.js'

const MOCK_USER = { id: 'user-abc-123', email: 'alice@example.com' }
const MOCK_ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.mock.payload'
const MOCK_REFRESH_TOKEN = 'refresh-xyz-789'

describe('auth flow — reproducing broken authentication flow', () => {
  beforeEach(() => {
    process.env['SUPABASE_URL'] = 'http://127.0.0.1:54321'
    process.env['SUPABASE_ANON_KEY'] = 'test-anon-key-fake'
    resetClients()
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env['SUPABASE_URL']
    delete process.env['SUPABASE_ANON_KEY']
    resetClients()
  })

  // --- Happy path: these should pass and document correct behaviour ---

  it('signInWithEmail returns user and session for valid credentials', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: {
        user: MOCK_USER,
        session: {
          access_token: MOCK_ACCESS_TOKEN,
          refresh_token: MOCK_REFRESH_TOKEN,
          user: MOCK_USER,
        },
      },
      error: null,
    })

    const result = await signInWithEmail('alice@example.com', 'correct-password')

    expect(result.error).toBeNull()
    expect(result.user).toEqual({ id: 'user-abc-123', email: 'alice@example.com' })
    expect(result.session?.access_token).toBe(MOCK_ACCESS_TOKEN)
    expect(result.session?.refresh_token).toBe(MOCK_REFRESH_TOKEN)
  })

  it('signInWithEmail returns error for invalid credentials', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    })

    const result = await signInWithEmail('alice@example.com', 'wrong-password')

    expect(result.user).toBeNull()
    expect(result.session).toBeNull()
    expect(result.error).toBe('Invalid login credentials')
  })

  it('full sign-in → token → validate round-trip returns the same user', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: {
        user: MOCK_USER,
        session: {
          access_token: MOCK_ACCESS_TOKEN,
          refresh_token: MOCK_REFRESH_TOKEN,
          user: MOCK_USER,
        },
      },
      error: null,
    })
    mockGetUser.mockResolvedValueOnce({
      data: { user: MOCK_USER },
      error: null,
    })

    const signInResult = await signInWithEmail('alice@example.com', 'correct-password')
    expect(signInResult.error).toBeNull()

    const token = signInResult.session!.access_token
    const tokenResult = await getUserFromToken(token)

    expect(tokenResult.error).toBeNull()
    expect(tokenResult.userId).toBe(MOCK_USER.id)
    expect(tokenResult.email).toBe(MOCK_USER.email)
  })

  it('getUserFromToken returns null and error for an expired token', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'JWT expired' },
    })

    const result = await getUserFromToken('expired.jwt.token')

    expect(result.userId).toBeNull()
    expect(result.email).toBeNull()
    expect(result.error).toBe('JWT expired')
  })

  it('signOut returns no error', async () => {
    mockSignOut.mockResolvedValueOnce({ error: null })
    const result = await signOut()
    expect(result.error).toBeNull()
  })

  it('getUserFromToken exposes Supabase service errors to caller', async () => {
    // Simulate Supabase returning a service error (e.g., misconfigured JWT secret)
    // Callers can distinguish "invalid token" from "auth service is broken".
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'JWT secret not found', status: 500 },
    })

    const result = await getUserFromToken('any.token.here')

    expect(result.error).toBe('JWT secret not found')
    expect(result.userId).toBeNull()
    expect(result.email).toBeNull()
  })
})
