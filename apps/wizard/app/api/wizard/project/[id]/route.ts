/**
 * GET /api/wizard/project/[id]     — read project state (owner-only)
 * PUT /api/wizard/project/[id]     — replace state_json (owner-only)
 * DELETE /api/wizard/project/[id]  — delete (owner-only)
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db/pool';
import { readAuthedUser } from '../../../../../lib/backend/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ id: string }>; }

export async function GET(_: Request, ctx: Ctx): Promise<NextResponse> {
  const me = await readAuthedUser();
  if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  const { id } = await ctx.params;
  const rows = await query<{ id: string; name: string | null; state_json: unknown; updated_at: Date }>(
    'SELECT id, name, state_json, updated_at FROM wizard_projects WHERE id = $1 AND user_id = $2',
    [id, me.id],
  );
  if (rows.length === 0) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, project: rows[0] });
}

export async function PUT(req: Request, ctx: Ctx): Promise<NextResponse> {
  const me = await readAuthedUser();
  if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  const { id } = await ctx.params;
  let body: { name?: unknown; stateJson?: unknown };
  try { body = (await req.json()) as { name?: unknown; stateJson?: unknown }; } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const name = typeof body.name === 'string' ? body.name.slice(0, 200) : null;
  const stateJson = body.stateJson && typeof body.stateJson === 'object' ? body.stateJson : {};
  const rows = await query<{ id: string }>(
    `UPDATE wizard_projects SET name = COALESCE($3, name), state_json = $4::jsonb, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, me.id, name, JSON.stringify(stateJson)],
  );
  if (rows.length === 0) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, ctx: Ctx): Promise<NextResponse> {
  const me = await readAuthedUser();
  if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  const { id } = await ctx.params;
  const rows = await query<{ id: string }>(
    'DELETE FROM wizard_projects WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, me.id],
  );
  if (rows.length === 0) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
