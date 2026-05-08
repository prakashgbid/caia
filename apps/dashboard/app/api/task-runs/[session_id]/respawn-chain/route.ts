import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ session_id: string }> }) {
  try {
    const { session_id } = await params;
    const res = await fetch(`${CONDUCTOR_URL}/task-runs/${session_id}/respawn-chain`, { next: { revalidate: 0 } });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
