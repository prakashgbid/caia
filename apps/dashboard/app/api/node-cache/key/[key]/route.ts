import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await params;
    const res = await fetch(
      `${CONDUCTOR_URL}/node-cache/key/${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) return NextResponse.json({ ok: false }, { status: 200 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'unreachable' }, { status: 200 });
  }
}
