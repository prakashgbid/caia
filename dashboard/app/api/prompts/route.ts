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

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      text?: string;
      projectId?: string;
      priority?: string;
      source?: string;
      skipDecomposition?: boolean;
    };

    // Map dashboard fields → orchestrator fields
    const orchestratorBody = {
      body: body.text ?? '',
      received_via: body.source ?? 'dashboard',
      metadata: {
        ...(body.projectId ? { projectId: body.projectId } : {}),
        ...(body.priority ? { priority: body.priority } : {}),
        ...(body.skipDecomposition !== undefined ? { skipDecomposition: body.skipDecomposition } : {}),
        source: body.source ?? 'dashboard',
      },
    };

    const res = await fetch(`${CONDUCTOR_URL}/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orchestratorBody),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Failed to submit prompt' }, { status: 503 });
  }
}
