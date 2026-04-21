import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(request: NextRequest) {
  const root = request.nextUrl.searchParams.get('root');
  const url = root
    ? `${CONDUCTOR_URL}/dag?root=${encodeURIComponent(root)}`
    : `${CONDUCTOR_URL}/dag`;

  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json({ nodes: [], edges: [] }, { status: 200 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ nodes: [], edges: [] }, { status: 200 });
  }
}
