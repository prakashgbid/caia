import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const params = new URLSearchParams();
  for (const key of ['status', 'plan', 'email']) {
    const val = searchParams.get(key);
    if (val) params.set(key, val);
  }
  const qs = params.toString() ? `?${params.toString()}` : '';
  try {
    const res = await fetch(`${CONDUCTOR_URL}/subscriptions${qs}`, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json({ subscriptions: [], total: 0 }, { status: 200 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ subscriptions: [], total: 0 }, { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${CONDUCTOR_URL}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'upstream unavailable' }, { status: 503 });
  }
}
