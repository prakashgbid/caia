/**
 * Dashboard API proxy: GET /api/admin/users, POST /api/admin/users
 * Forwards to the Conductor orchestrator's admin users endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';

const ORCHESTRATOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(): Promise<NextResponse> {
  try {
    const upstream = await fetch(
      `${ORCHESTRATOR_URL}/admin/users`,
      { next: { revalidate: 10 } },
    );

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as unknown;
    const upstream = await fetch(`${ORCHESTRATOR_URL}/admin/users`, {
      method: 'POST',
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
