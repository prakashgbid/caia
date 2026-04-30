/**
 * Dashboard API proxy: PATCH /api/admin/users/[id]
 * Forwards to the Conductor orchestrator to update a persisted user record.
 */

import { NextRequest, NextResponse } from 'next/server';

const ORCHESTRATOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const body = await req.json() as unknown;
    const upstream = await fetch(`${ORCHESTRATOR_URL}/admin/users/${encodeURIComponent(params.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await upstream.json() as unknown;
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
