/**
 * Cookie-based session helpers for the wizard backend.
 *
 * Session cookie: `caia_wizard_session=sess_<random>`
 * TTL: 30 days, sliding — every authenticated request extends expires_at.
 */

import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { query } from '../db/pool';

const COOKIE = 'caia_wizard_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
  provider: string;
  tokensBalance: number;
  hasByok: boolean;
}

export async function createSessionFor(userId: string): Promise<string> {
  const token = 'sess_' + randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MS);
  await query(
    'INSERT INTO wizard_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expiresAt],
  );
  const c = await cookies();
  c.set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const c = await cookies();
  const t = c.get(COOKIE)?.value;
  if (t) {
    await query('DELETE FROM wizard_sessions WHERE token = $1', [t]);
    c.delete(COOKIE);
  }
}

export async function readAuthedUser(): Promise<AuthedUser | null> {
  const c = await cookies();
  const t = c.get(COOKIE)?.value;
  if (!t) return null;
  const rows = await query<{
    id: string; email: string; display_name: string; provider: string; tokens_balance: number; byok_key_enc: Buffer | null;
    expires_at: Date;
  }>(
    `SELECT u.id, u.email, u.display_name, u.provider, u.tokens_balance, u.byok_key_enc, s.expires_at
       FROM wizard_sessions s
       JOIN wizard_users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > NOW()
      LIMIT 1`,
    [t],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  // Sliding session: extend on read
  const newExp = new Date(Date.now() + TTL_MS);
  await query('UPDATE wizard_sessions SET expires_at = $1 WHERE token = $2', [newExp, t]);
  c.set(COOKIE, t, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires: newExp });
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    provider: r.provider,
    tokensBalance: r.tokens_balance,
    hasByok: !!r.byok_key_enc,
  };
}
