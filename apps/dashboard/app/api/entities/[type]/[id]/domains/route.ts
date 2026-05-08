import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  try {
    const { type, id } = await params;
    const res = await fetch(`${CONDUCTOR_URL}/entities/${type}/${id}/domains`, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json([], { status: 200 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  try {
    const { type, id } = await params;
    const body = await req.json();
    const res = await fetch(`${CONDUCTOR_URL}/entities/${type}/${id}/domains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
