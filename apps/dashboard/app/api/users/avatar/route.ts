import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${CONDUCTOR_URL}/users/avatar`, {
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

export async function DELETE() {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/users/avatar`, { method: 'DELETE' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
