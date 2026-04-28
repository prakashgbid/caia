/**
 * Dashboard API proxy: GET /api/agents
 * Forwards to the Conductor orchestrator's agent registry endpoint.
 */

import { NextResponse } from 'next/server';

const ORCHESTRATOR_URL = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const tier   = searchParams.get('tier')   ?? '';
  const status = searchParams.get('status') ?? '';

  const qs = new URLSearchParams();
  if (tier)   qs.set('tier',   tier);
  if (status) qs.set('status', status);

  try {
    const upstream = await fetch(
      `${ORCHESTRATOR_URL}/agents${qs.size ? `?${qs.toString()}` : ''}`,
      { next: { revalidate: 10 } },  // ISR — refresh every 10 s
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
