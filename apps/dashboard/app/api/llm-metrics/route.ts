// LAI-006 — Next.js proxy for the orchestrator's GET /llm/metrics endpoint.
// Mirrors the pattern of api/metrics/route.ts so the dashboard never needs
// the orchestrator's URL hardcoded into client components.

import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET() {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/llm/metrics`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) return NextResponse.json(null, { status: 200 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(null, { status: 200 });
  }
}
