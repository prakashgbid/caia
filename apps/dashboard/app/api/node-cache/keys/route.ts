import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(req: NextRequest) {
  try {
    const pattern = req.nextUrl.searchParams.get('pattern') ?? '';
    const url = pattern
      ? `${CONDUCTOR_URL}/node-cache/keys?pattern=${encodeURIComponent(pattern)}`
      : `${CONDUCTOR_URL}/node-cache/keys`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json({ count: 0, keys: [] }, { status: 200 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ count: 0, keys: [], error: 'unreachable' }, { status: 200 });
  }
}
