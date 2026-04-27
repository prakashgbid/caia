import { NextRequest, NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams.toString();
  try {
    const res = await fetch(
      `${CONDUCTOR_URL}/prompts${params ? '?' + params : ''}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return NextResponse.json({ prompts: [] }, { status: 200 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ prompts: [] }, { status: 200 });
  }
}
