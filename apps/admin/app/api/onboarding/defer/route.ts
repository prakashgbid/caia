import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getEngine } from '../../../../lib/engine';
import { authContext } from '../../../../lib/auth';

const Body = z.object({
  tenantId: z.string().min(1),
  category: z.string().min(1),
  reason: z.string().min(1).default('customer-skipped'),
});

export async function POST(req: NextRequest) {
  const auth = authContext(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: `invalid body: ${(e as Error).message}` },
      { status: 400 },
    );
  }
  const { engine } = getEngine();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await engine.defer(body.tenantId, body.category as any, body.reason);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
