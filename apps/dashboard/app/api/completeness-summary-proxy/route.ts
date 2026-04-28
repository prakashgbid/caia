import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(_req: NextRequest) {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/completeness/summary`, { next: { revalidate: 0 } });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ entities: [], total: 0, passing: 0, failing: 0 }, { status: 200 });
  }
}
