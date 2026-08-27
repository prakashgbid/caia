/**
 * POST /api/wizard/auth/login
 *
 * Body: { provider: 'google' | 'apple' | 'email', email, displayName? }
 *
 * Mock auth: any valid email + display name creates a user (or looks up
 * existing by email) and issues a session cookie. Real OAuth is a
 * post-payment upgrade — the whole point of this endpoint is to give the
 * frontend a real user id + session it can migrate its anonymous project to.
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db/pool';
import { createSessionFor, newId } from '../../../../../lib/backend/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  provider?: unknown;
  email?: unknown;
  displayName?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const provider = String(body.provider || 'email').toLowerCase();
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const displayName = (typeof body.displayName === 'string' ? body.displayName : '').trim().slice(0, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 });
  if (!['google', 'apple', 'email'].includes(provider)) return NextResponse.json({ ok: false, error: 'invalid_provider' }, { status: 400 });

  const existing = await query<{ id: string; display_name: string; tokens_balance: number }>(
    'SELECT id, display_name, tokens_balance FROM wizard_users WHERE email = $1 LIMIT 1',
    [email],
  );

  let userId: string;
  let tokensBalance: number;
  if (existing.length > 0) {
    userId = existing[0].id;
    tokensBalance = existing[0].tokens_balance;
    // Update display_name/provider on relogin if fresher
    if (displayName && displayName !== existing[0].display_name) {
      await query('UPDATE wizard_users SET display_name = $1, updated_at = NOW() WHERE id = $2', [displayName, userId]);
    }
  } else {
    userId = newId('u');
    const name = displayName || email.split('@')[0];
    await query(
      'INSERT INTO wizard_users (id, email, display_name, provider) VALUES ($1, $2, $3, $4)',
      [userId, email, name, provider],
    );
    // Grant +100 tokens for first login
    await query(
      "INSERT INTO wizard_token_events (user_id, delta, reason) VALUES ($1, 100, 'earn:signup')",
      [userId],
    );
    await query('UPDATE wizard_users SET tokens_balance = tokens_balance + 100 WHERE id = $1', [userId]);
    tokensBalance = 250;
  }

  await createSessionFor(userId);
  return NextResponse.json({ ok: true, userId, tokensBalance });
}
