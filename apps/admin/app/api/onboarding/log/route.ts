import { NextResponse, type NextRequest } from 'next/server';
import { getEngine } from '../../../../lib/engine';
import { authContext } from '../../../../lib/auth';

export async function GET(req: NextRequest) {
  const auth = authContext(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const tenantId = req.nextUrl.searchParams.get('tenantId') ?? 'dev-tenant';
  const { store } = getEngine();
  const entries = await store.listAudit(tenantId, 200);
  return NextResponse.json({
    entries: entries.map((e) => ({
      occurredAt: e.occurredAt.toISOString(),
      actorType: e.actorType,
      actorId: e.actorId ?? null,
      action: e.action,
      category: e.category ?? null,
      keyId: e.keyId ?? null,
      payload: e.payload,
    })),
  });
}
