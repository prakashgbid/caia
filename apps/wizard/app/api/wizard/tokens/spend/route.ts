/**
 * POST /api/wizard/tokens/spend
 * Body: { delta: number (negative for spend, positive for earn), reason: string, projectId?: string }
 *
 * Server-authoritative token ledger.
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db/pool';
import { readAuthedUser } from '../../../../../lib/backend/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { delta?: unknown; reason?: unknown; projectId?: unknown; }

export async function POST(req: Request): Promise<NextResponse> {
  const me = await readAuthedUser();
  if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const delta = typeof body.delta === 'number' && Number.isInteger(body.delta) ? body.delta : 0;
  const reason = typeof body.reason === 'string' && body.reason.length > 0 ? body.reason.slice(0, 80) : 'unknown';
  const projectId = typeof body.projectId === 'string' ? body.projectId : null;
  if (delta === 0 || Math.abs(delta) > 100_000) return NextResponse.json({ ok: false, error: 'invalid_delta' }, { status: 400 });

  const client = await (await import('../../../../../lib/db/pool')).db().connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<{ tokens_balance: number }>('SELECT tokens_balance FROM wizard_users WHERE id = $1 FOR UPDATE', [me.id]);
    const bal = cur.rows[0]?.tokens_balance ?? 0;
    if (delta < 0 && bal + delta < 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ ok: false, error: 'insufficient_tokens', balance: bal }, { status: 402 });
    }
    await client.query('UPDATE wizard_users SET tokens_balance = tokens_balance + $2, updated_at = NOW() WHERE id = $1', [me.id, delta]);
    await client.query(
      'INSERT INTO wizard_token_events (user_id, delta, reason, project_id) VALUES ($1, $2, $3, $4)',
      [me.id, delta, reason, projectId],
    );
    await client.query('COMMIT');
    return NextResponse.json({ ok: true, balance: bal + delta });
  } catch (e) {
    await client.query('ROLLBACK');
    return NextResponse.json({ ok: false, error: 'db_error', detail: (e as Error).message }, { status: 500 });
  } finally {
    client.release();
  }
}
