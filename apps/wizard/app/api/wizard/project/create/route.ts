/**
 * POST /api/wizard/project/create
 * Body: { name?, stateJson? }
 * Auth required. Returns new project id.
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db/pool';
import { newId, readAuthedUser } from '../../../../../lib/backend/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { name?: unknown; stateJson?: unknown; }

export async function POST(req: Request): Promise<NextResponse> {
  const me = await readAuthedUser();
  if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let body: Body;
  try { body = (await req.json()) as Body; } catch { body = {}; }
  const name = typeof body.name === 'string' ? body.name.slice(0, 200) : null;
  const stateJson = body.stateJson && typeof body.stateJson === 'object' ? body.stateJson : {};
  const id = newId('p');
  await query(
    'INSERT INTO wizard_projects (id, user_id, name, state_json) VALUES ($1, $2, $3, $4::jsonb)',
    [id, me.id, name, JSON.stringify(stateJson)],
  );
  return NextResponse.json({ ok: true, id });
}
