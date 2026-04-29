/**
 * Dashboard API proxy: /api/architecture/* (ARCH-007)
 * Forwards to the orchestrator's /api/architecture/* endpoints.
 */
import { NextResponse } from 'next/server';

const ORCHESTRATOR_URL = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

export async function GET(
  request: Request,
  context: { params: { path: string[] } },
): Promise<NextResponse> {
  const subPath = context.params.path.join('/');
  const upstreamUrl = new URL(`${ORCHESTRATOR_URL}/api/architecture/${subPath}`);
  const { searchParams } = new URL(request.url);
  for (const [k, v] of searchParams.entries()) {
    upstreamUrl.searchParams.set(k, v);
  }
  try {
    const upstream = await fetch(upstreamUrl.toString(), { cache: 'no-store' });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream ${upstream.status}` },
        { status: upstream.status },
      );
    }
    const data = (await upstream.json()) as unknown;
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
