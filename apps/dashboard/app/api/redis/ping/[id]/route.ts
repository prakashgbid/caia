import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/redis/ping/${params.id}`, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json({ ok: false, error: `HTTP ${res.status}` }, { status: 200 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'unreachable' }, { status: 200 });
  }
}
