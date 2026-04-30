/**
 * Dashboard API proxy: GET /api/profile, PATCH /api/profile
 * Forwards to the Conductor orchestrator's profile endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';

const ORCHESTRATOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = req.nextUrl.searchParams.get('userId');
    const url = userId
      ? `${ORCHESTRATOR_URL}/profile/${encodeURIComponent(userId)}`
      : `${ORCHESTRATOR_URL}/profile`;

    const upstream = await fetch(url, { next: { revalidate: 0 } });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream error ${upstream.status}` },
        { status: upstream.status },
      );
    }

    const data = await upstream.json() as unknown;
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as unknown;
    const upstream = await fetch(`${ORCHESTRATOR_URL}/profile`, {
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
