import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(request: NextRequest) {
  try {
    const qs = request.nextUrl.search;
    const res = await fetch(`${CONDUCTOR_URL}/notifications${qs}`, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json({ notifications: [], total: 0 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ notifications: [], total: 0 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${CONDUCTOR_URL}/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status });
    return NextResponse.json(await res.json(), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
