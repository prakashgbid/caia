import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function POST() {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/node-cache/reset`, { method: 'POST' });
    if (!res.ok) return NextResponse.json({ ok: false }, { status: 200 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'unreachable' }, { status: 200 });
  }
}
