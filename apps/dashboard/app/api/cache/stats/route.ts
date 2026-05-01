import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET() {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/cache/stats`, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json(null, { status: 200 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json(null, { status: 200 });
  }
}
