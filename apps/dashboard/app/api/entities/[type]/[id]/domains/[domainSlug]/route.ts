import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ type: string; id: string; domainSlug: string }> }) {
  try {
    const { type, id, domainSlug } = await params;
    const res = await fetch(
      `${CONDUCTOR_URL}/entities/${type}/${id}/domains/${domainSlug}`,
      { method: 'DELETE' }
    );
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
