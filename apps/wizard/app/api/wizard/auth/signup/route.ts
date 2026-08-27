/**
 * POST /api/wizard/auth/signup
 * Body: { email, displayName, password }
 * Creates a user with hashed password + issues session cookie + grants +100 tokens.
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db/pool';
import { createSessionFor, newId } from '../../../../../lib/backend/session';
import { hashPassword, validatePasswordStrength } from '../../../../../lib/backend/passwords';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { email?: unknown; displayName?: unknown; password?: unknown; }

export async function POST(req: Request): Promise<NextResponse> {
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const displayName = (typeof body.displayName === 'string' ? body.displayName : '').trim().slice(0, 80);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 });
  if (displayName.length < 2) return NextResponse.json({ ok: false, error: 'invalid_name' }, { status: 400 });
  const pw = validatePasswordStrength(password);
  if (!pw.ok) return NextResponse.json({ ok: false, error: 'weak_password', reason: pw.reason }, { status: 400 });

  const existing = await query('SELECT id FROM wizard_users WHERE email = $1 LIMIT 1', [email]);
  if (existing.length > 0) return NextResponse.json({ ok: false, error: 'email_in_use' }, { status: 409 });

  const userId = newId('u');
  const hash = hashPassword(password);
  await query(
    'INSERT INTO wizard_users (id, email, display_name, provider, password_hash) VALUES ($1, $2, $3, $4, $5)',
    [userId, email, displayName, 'email-password', hash],
  );
  await query("INSERT INTO wizard_token_events (user_id, delta, reason) VALUES ($1, 100, 'earn:signup')", [userId]);
  await query('UPDATE wizard_users SET tokens_balance = tokens_balance + 100 WHERE id = $1', [userId]);
  await createSessionFor(userId);
  return NextResponse.json({ ok: true, userId, tokensBalance: 250 });
}
