/**
 * PROD-VALIDATE-1: Reproducing test — broken authentication flow
 *
 * These tests document the specific failure modes that caused the production
 * authentication outage. Each test describes the symptom observed in production
 * and the expected correct behaviour after the fix.
 *
 * Failure pattern: the auth layer silently returned ambiguous success/failure
 * combinations that callers could not reliably distinguish, leading to:
 *   - Users seeing logged-in state with no identity (null user + live session)
 *   - Token validation succeeding with wrong email (email fallback masking mismatch)
 *   - Empty/whitespace tokens not rejected at boundary — reaching Supabase unnecessarily
 *   - Sign-up returning no session without signalling the confirmation-pending state
 *   - Network errors reaching callers as unhandled rejections instead of AuthResult
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

import { signInWithEmail, signUpWithEmail, getUserFromToken } from '../src/auth/index.js'
import { resetClients } from '../src/client.js'

describe('PROD-VALIDATE-1 — broken authentication flow regression', () => {
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

  // --- BUG 1: Null user with live session (silent partial success) ---
  // Supabase can return a session but no user in edge cases (token provisioned before
  // the user row committed). The old code passed this through unchanged — callers
  // received error:null but user:null, which was indistinguishable from a successful
  // anonymous session, allowing unauthenticated UI states to render as authenticated.
  it('[PROD-VALIDATE-1-B1] signInWithEmail treats null-user + live-session as an error', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: {
        user: null,
        session: {
          access_token: 'live.session.token',
          refresh_token: 'live.refresh.token',
        },
      },
      error: null,
    })

    const result = await signInWithEmail('alice@example.com', 'correct-password')

    // A session without a user is an error state, not a success.
    expect(result.user).toBeNull()
    expect(result.session).toBeNull()
    expect(result.error).not.toBeNull()
  })

  // --- BUG 2: Email fallback masking identity mismatch ---
  // When data.user.email is null (can happen with SSO-linked accounts), the signin
  // function fell back to the caller-supplied `email` parameter. This masked token/user
  // mismatches — the returned AuthResult appeared correct even when the Supabase user
  // record had a different email (e.g., a different case or alias).
  it('[PROD-VALIDATE-1-B2] signInWithEmail surfaces null email as an error rather than silently substituting caller input', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: {
        user: { id: 'user-abc-123', email: null },
        session: {
          access_token: 'eyJhbGciOiJIUzI1NiJ9.mock.token',
          refresh_token: 'refresh-xyz',
        },
      },
      error: null,
    })

    const result = await signInWithEmail('alice@example.com', 'correct-password')

    // The returned email must come from the authoritative user record, not input.
    // If the record has no email the result must carry an error, not a fallback value.
    expect(result.error).not.toBeNull()
    expect(result.user).toBeNull()
  })

  // --- BUG 3: Empty token not rejected before hitting Supabase ---
  // Callers passing an empty string or whitespace-only token triggered a live Supabase
  // request that returned an opaque error. Boundary validation was absent, leading to
  // unnecessary network overhead and confusing error messages surfaced to end-users.
  it('[PROD-VALIDATE-1-B3] getUserFromToken rejects empty string token without calling Supabase', async () => {
    const result = await getUserFromToken('')

    expect(result.userId).toBeNull()
    expect(result.email).toBeNull()
    expect(result.error).not.toBeNull()
    // Supabase must not be contacted for a trivially invalid token.
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('[PROD-VALIDATE-1-B3b] getUserFromToken rejects whitespace-only token without calling Supabase', async () => {
    const result = await getUserFromToken('   ')

    expect(result.userId).toBeNull()
    expect(result.error).not.toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  // --- BUG 4: Sign-up returns user but no session (confirmation pending) ---
  // When Supabase email confirmation is enabled, signUpWithEmail returns a user object
  // but session is null. The old code returned { user: {...}, session: null, error: null }
  // which callers treated as a successful login — allowing a confirmed-email-required
  // account to reach protected routes before the user confirmed their address.
  // Fix: when user is present but session is absent (and no Supabase error), the function
  // must set error to a descriptive message so callers know confirmation is pending.
  it('[PROD-VALIDATE-1-B4] signUpWithEmail with confirmation-pending state surfaces an explicit error message', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: {
        user: { id: 'user-new-456', email: 'bob@example.com' },
        session: null, // email confirmation required — Supabase sends no error here
      },
      error: null,
    })

    const result = await signUpWithEmail('bob@example.com', 'SecurePass123!')

    // After the fix, callers must receive a non-null error explaining the pending state.
    // Current broken behaviour: error is null, giving no indication confirmation is required.
    expect(result.error).not.toBeNull()
    // Session must still be null (user is not yet authenticated).
    expect(result.session).toBeNull()
  })

  // --- BUG 5: Network error reaches caller as unhandled rejection ---
  // A transient network failure during signInWithEmail caused the Promise to reject,
  // propagating as an unhandled rejection to the Next.js API handler. The auth layer
  // must catch and normalise all Supabase errors into the AuthResult shape.
  it('[PROD-VALIDATE-1-B5] signInWithEmail catches network errors and returns them as AuthResult', async () => {
    mockSignInWithPassword.mockRejectedValueOnce(new Error('fetch failed: ECONNREFUSED'))

    // Must not throw — must resolve to an AuthResult with error set.
    await expect(
      signInWithEmail('alice@example.com', 'correct-password'),
    ).resolves.toMatchObject({
      user: null,
      session: null,
      error: expect.stringContaining('fetch failed'),
    })
  })

  it('[PROD-VALIDATE-1-B5b] getUserFromToken catches network errors and returns them as SessionData', async () => {
    mockGetUser.mockRejectedValueOnce(new Error('upstream timeout'))

    await expect(
      getUserFromToken('eyJhbGciOiJIUzI1NiJ9.valid.looking.token'),
    ).resolves.toMatchObject({
      userId: null,
      email: null,
      error: expect.stringContaining('upstream timeout'),
    })
  })
})
