/**
 * Dashboard API proxy: GET /api/metrics/phase1
 * Forwards to the orchestrator's /metrics/phase1 endpoint (GATE-4-04).
 */
import { NextResponse } from 'next/server';

const ORCHESTRATOR_URL = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

export async function GET(request: Request): Promise<NextResponse> {
  const upstreamUrl = new URL(`${ORCHESTRATOR_URL}/metrics/phase1`);
  const { searchParams } = new URL(request.url);
  const win = searchParams.get('windowMin');
  if (win) upstreamUrl.searchParams.set('windowMin', win);
  try {
    const upstream = await fetch(upstreamUrl.toString(), { cache: 'no-store' });
    if (!upstream.ok) return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: upstream.status });
    const data = await upstream.json() as unknown;
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
