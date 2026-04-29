import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

export async function GET() {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/api/contracts/registry`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) return NextResponse.json({ contracts: [], count: 0 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ contracts: [], count: 0 });
  }
}
