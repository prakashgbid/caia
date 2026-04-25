import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET() {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/health`, { next: { revalidate: 0 } });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Conductor returned ${res.status}` }, { status: 200 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ ok: false, error: 'Conductor unreachable' }, { status: 200 });
  }
}
