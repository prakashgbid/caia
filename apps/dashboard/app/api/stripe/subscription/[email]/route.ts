import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(
  _request: NextRequest,
  { params }: { params: { email: string } },
) {
  try {
    const email = decodeURIComponent(params.email);
    const res = await fetch(`${CONDUCTOR_URL}/stripe/subscription/${encodeURIComponent(email)}`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) return NextResponse.json({ subscription: null }, { status: 200 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ subscription: null }, { status: 200 });
  }
}
