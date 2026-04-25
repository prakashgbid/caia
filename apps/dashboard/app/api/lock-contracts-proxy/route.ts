import { NextResponse } from 'next/server';

const CONDUCTOR = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  try {
    const res = await fetch(`${CONDUCTOR}/lock-contracts${qs ? '?' + qs : ''}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
