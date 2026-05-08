import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function POST(req: NextRequest, { params }: { params: Promise<{ session_id: string }> }) {
  try {
    const { session_id } = await params;
    const body = await req.json();
    const res = await fetch(`${CONDUCTOR_URL}/task-runs/${session_id}/subtasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
