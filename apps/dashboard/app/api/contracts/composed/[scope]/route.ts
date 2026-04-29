import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ scope: string }> },
) {
  const { scope } = await ctx.params;
  try {
    const res = await fetch(`${CONDUCTOR_URL}/api/contracts/composed/${encodeURIComponent(scope)}`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { scope, sections: [], warnings: [], signature: '', sectionCount: 0 },
        { status: res.status },
      );
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json(
      { scope, sections: [], warnings: [], signature: '', sectionCount: 0 },
      { status: 502 },
    );
  }
}
