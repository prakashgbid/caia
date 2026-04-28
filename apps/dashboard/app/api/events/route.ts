import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(request: NextRequest) {
  const since = request.nextUrl.searchParams.get('since');
  const url = since
    ? `${CONDUCTOR_URL}/events?since=${encodeURIComponent(since)}`
    : `${CONDUCTOR_URL}/events`;

  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json([], { status: 200 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
