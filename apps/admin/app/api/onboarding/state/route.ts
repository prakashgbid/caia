import { NextResponse, type NextRequest } from 'next/server';
import { getEngine } from '../../../../lib/engine';
import { authContext } from '../../../../lib/auth';

export async function GET(req: NextRequest) {
  const auth = authContext(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const tenantId = req.nextUrl.searchParams.get('tenantId') ?? 'dev-tenant';
  const { engine } = getEngine();
  const state = await engine.stateFor(tenantId);
  return NextResponse.json({
    tenantId: state.tenantId,
    currentId: state.current?.id ?? null,
    ready: state.ready,
    steps: state.steps.map((s) => ({
      category: {
        id: s.category.id,
        label: s.category.label,
        ordinal: s.category.ordinal,
        required: s.category.required,
      },
      status: s.status,
      attemptCount: s.attemptCount,
      ...(s.failureReason ? { failureReason: s.failureReason } : {}),
    })),
  });
}
