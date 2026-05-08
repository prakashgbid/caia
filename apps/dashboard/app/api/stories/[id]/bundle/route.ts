/**
 * Dashboard API proxy: GET /api/stories/:id/bundle
 *
 * Forwards to the orchestrator's GET /stories/:id/bundle endpoint
 * (the Phase-1 self-contained ticket bundle introduced in PR #75).
 * Used by the story-detail page to render the strict TicketTemplateV1
 * sections (GATE-4-03).
 */
import { NextResponse } from 'next/server';

const ORCHESTRATOR_URL = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await params;
    const upstream = await fetch(
      `${ORCHESTRATOR_URL}/stories/${encodeURIComponent(id)}/bundle`,
      { cache: 'no-store' },
    );
    if (!upstream.ok) return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: upstream.status });
    const data = await upstream.json() as unknown;
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
