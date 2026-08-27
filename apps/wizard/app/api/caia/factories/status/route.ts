/**
 * GET /api/caia/factories/status
 *
 * Returns the live status of all CAIA SFs + Control-Plane components.
 * For now the source of truth is the static lib/factory/phases.ts snapshot,
 * shipped as-is with a `source: 'snapshot'` marker so the client knows it
 * isn't live-polled yet. Later this endpoint will proxy /api/caia/registry
 * on the caia-platform.
 *
 * Public (no auth required) — status is not sensitive.
 */

import { NextResponse } from 'next/server';
import { SOFTWARE_FACTORIES, CONTROL_PLANE } from '../../../../../lib/factory/phases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const done = SOFTWARE_FACTORIES.filter((s) => s.status === 'done').length + CONTROL_PLANE.filter((c) => c.status === 'done').length;
  const inProgress = SOFTWARE_FACTORIES.filter((s) => s.status === 'in-progress').length + CONTROL_PLANE.filter((c) => c.status === 'in-progress').length;
  const todo = SOFTWARE_FACTORIES.filter((s) => s.status === 'todo').length + CONTROL_PLANE.filter((c) => c.status === 'todo').length;
  return NextResponse.json({
    ok: true,
    source: 'snapshot',
    updatedAt: new Date().toISOString(),
    counts: { done, inProgress, todo, total: SOFTWARE_FACTORIES.length + CONTROL_PLANE.length },
    softwareFactories: SOFTWARE_FACTORIES,
    controlPlane: CONTROL_PLANE,
  });
}
