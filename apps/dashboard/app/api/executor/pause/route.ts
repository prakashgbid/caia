import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function POST() {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/executor/pause`, { method: 'POST' });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
