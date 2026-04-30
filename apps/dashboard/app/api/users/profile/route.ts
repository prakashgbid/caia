import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET() {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/users/profile`, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json({ id: 'default', displayName: '', avatarUrl: null }, { status: 200 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ id: 'default', displayName: '', avatarUrl: null }, { status: 200 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${CONDUCTOR_URL}/users/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
