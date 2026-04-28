/**
 * /api/requirements/[id] — proxy for the orchestrator's GET /requirements/:id.
 *
 * DASH-301: the dashboard's /requirements/[id] page used to fetch the
 * full collection and client-filter, which broke at scale (14 MB).
 * It now fetches a single row via this proxy.
 */
import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/requirements/${encodeURIComponent(params.id)}`, { next: { revalidate: 0 } });
    if (!res.ok) {
      return NextResponse.json({ error: 'Not found' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'upstream error' }, { status: 502 });
  }
}
