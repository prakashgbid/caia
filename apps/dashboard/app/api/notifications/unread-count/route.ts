import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(request: NextRequest) {
  try {
    const qs = request.nextUrl.search;
    const res = await fetch(`${CONDUCTOR_URL}/notifications/unread-count${qs}`, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json({ count: 0 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
