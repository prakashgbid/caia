import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams.toString();
  try {
    const res = await fetch(
      `${CONDUCTOR_URL}/timeline${params ? '?' + params : ''}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return NextResponse.json({ events: [], nextCursor: null, total: 0 }, { status: 200 });
    const data = await res.json();
    // Handle both array (legacy) and paginated object response
    if (Array.isArray(data)) {
      return NextResponse.json({ events: data, nextCursor: null, total: data.length });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ events: [], nextCursor: null, total: 0 }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${CONDUCTOR_URL}/timeline`, {
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
