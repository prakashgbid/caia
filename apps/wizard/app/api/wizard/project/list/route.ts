/**
 * GET /api/wizard/project/list — current user's projects (most-recent first).
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db/pool';
import { readAuthedUser } from '../../../../../lib/backend/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const me = await readAuthedUser();
  if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  const rows = await query<{ id: string; name: string | null; updated_at: Date }>(
    'SELECT id, name, updated_at FROM wizard_projects WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100',
    [me.id],
  );
  return NextResponse.json({
    ok: true,
    projects: rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at })),
  });
}
