import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getEngine } from '../../../../lib/engine';
import { authContext } from '../../../../lib/auth';

const Body = z.object({
  tenantId: z.string().min(1),
  category: z.string().min(1),
  providerId: z.string().min(1),
  choices: z.record(z.unknown()).default({}),
  credentials: z.record(z.string()).default({}),
});

export async function POST(req: NextRequest) {
  const auth = authContext(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try {
    const json = await req.json();
    body = Body.parse(json);
  } catch (e) {
    return NextResponse.json(
      { error: `invalid body: ${(e as Error).message}` },
      { status: 400 },
    );
  }
  const { engine } = getEngine();
  try {
    const result = await engine.submitStep({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tenantId: body.tenantId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      category: body.category as any,
      providerId: body.providerId,
      choices: body.choices,
      credentials: body.credentials,
      actor: {
        actorType: 'customer',
        actorId: auth.subject,
        userAgent: req.headers.get('user-agent') ?? undefined,
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
