/**
 * Dashboard API proxy: GET /api/buckets
 * Forwards to the orchestrator's /buckets endpoint (GATE-4-02).
 */
import { NextResponse } from 'next/server';

const ORCHESTRATOR_URL = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

export async function GET(request: Request): Promise<NextResponse> {
  const upstreamUrl = new URL(`${ORCHESTRATOR_URL}/buckets`);
  const { searchParams } = new URL(request.url);
  for (const k of ['promptId', 'domain', 'kind', 'status', 'limit']) {
    const v = searchParams.get(k);
    if (v) upstreamUrl.searchParams.set(k, v);
  }
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
