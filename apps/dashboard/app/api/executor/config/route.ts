import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${CONDUCTOR_URL}/executor/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}

export async function GET() {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/executor/config`, { next: { revalidate: 0 } });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
