/**
 * `GET /api/wizard/[projectId]/progress` — poll endpoint for B7
 * retry/backoff progress events.
 *
 * Returns the events accumulated in the per-project progress channel.
 * The UI polls this every 5s while a retry-prone step is mid-flight
 * (via SWR's `refreshInterval`); the channel ring-buffers the last 32
 * events so a brief refocus-during-retry doesn't drop info.
 *
 * `?since=<isoTimestamp>` filters to events with `occurredAtIso > since`
 * so the UI can avoid re-rendering already-seen events.
 *
 * Reuse-first compliance:
 *   - Reads from `getProgressChannel()` (the in-memory singleton).
 *   - No new transport; the future migration to `@chiefaia/event-bus-nats`
 *     would swap only the channel impl.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { getProgressChannel } from '../../../../../lib/wizard/progress-channel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

async function readTenantId(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-id');
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const tenantId = await readTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { projectId } = await Promise.resolve(ctx.params);
  const since = req.nextUrl.searchParams.get('since') ?? undefined;
  const channel = getProgressChannel();
  const events = channel.read(
    { tenantId, projectId },
    since ? { sinceIso: since } : {},
  );
  return NextResponse.json({
    projectId,
    events,
    polledAtIso: new Date().toISOString(),
  });
}
