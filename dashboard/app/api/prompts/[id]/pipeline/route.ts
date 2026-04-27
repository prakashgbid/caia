import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const res = await fetch(
      `${CONDUCTOR_URL}/prompts/${params.id}/pipeline`,
      { next: { revalidate: 0 } }
    );
    if (res.status === 404) return NextResponse.json(null, { status: 404 });
    if (!res.ok) return NextResponse.json(null, { status: 503 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(null, { status: 503 });
  }
}
