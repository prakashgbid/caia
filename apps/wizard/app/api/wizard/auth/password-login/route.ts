/**
 * POST /api/wizard/auth/password-login
 * Body: { email, password }
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db/pool';
import { createSessionFor } from '../../../../../lib/backend/session';
import { verifyPassword } from '../../../../../lib/backend/passwords';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { email?: unknown; password?: unknown; }

export async function POST(req: Request): Promise<NextResponse> {
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
    return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 });
  }
  const rows = await query<{ id: string; password_hash: string | null; tokens_balance: number; display_name: string }>(
    'SELECT id, password_hash, tokens_balance, display_name FROM wizard_users WHERE email = $1 LIMIT 1', [email],
  );
  if (rows.length === 0 || !rows[0].password_hash) {
    return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 });
  }
  if (!verifyPassword(password, rows[0].password_hash)) {
    return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 });
  }
  await createSessionFor(rows[0].id);
  return NextResponse.json({ ok: true, userId: rows[0].id, tokensBalance: rows[0].tokens_balance, displayName: rows[0].display_name });
}
