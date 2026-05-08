/**
 * Dashboard API proxy: GET /api/prompts/:id/phase1
 *
 * Forwards to the orchestrator's GATE-4-01 endpoint that surfaces every
 * Phase-1 surface for the journey page (pipeline stages, stories,
 * buckets, BA agent-collab thread, Phase-1 events). The dashboard polls
 * this once on load and refetches when a Phase-1 WS event arrives.
 */
import { NextResponse } from 'next/server';

const ORCHESTRATOR_URL = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  try {
    const upstream = await fetch(`${ORCHESTRATOR_URL}/prompts/${encodeURIComponent(id)}/phase1`, {
      cache: 'no-store',
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream ${upstream.status}` },
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
