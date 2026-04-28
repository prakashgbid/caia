/**
 * /api/audit — proxy for the orchestrator's /audit endpoint.
 *
 * DASH-201: the dashboard's /audit and /audit/[entityKind]/[entityId]
 * pages historically fetched /api/events, which returned ConductorEvent
 * envelopes (`type`, `payload`, `occurred_at`) but the page typed them
 * as AuditEntry (`actor`, `action`, `entityKind`, `entityId`, `before`,
 * `after`, `projectId`, `createdAt`). The shape mismatch made the page
 * empty in practice. This proxy forwards to the real /audit route.
 */
import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(request: NextRequest) {
  const params = new URLSearchParams();
  for (const [k, v] of request.nextUrl.searchParams.entries()) {
    params.set(k, v);
  }
  const qs = params.toString();
  const url = qs ? `${CONDUCTOR_URL}/audit?${qs}` : `${CONDUCTOR_URL}/audit`;

  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json([], { status: 200 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
