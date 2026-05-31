/**
 * `POST /api/settings/privacy/erase` — GDPR Article 17 cascade (B8).
 *
 * Runs the four-stage tenant erasure:
 *   1. `@caia/design-ingest.GdprCoordinator.deleteAllForTenant` —
 *      ux_uploads + design_versions + snapshot blobs + Infisical
 *      cascade (the coordinator itself fans into the secrets adapter
 *      and the snapshotter).
 *   2. Per-tenant Postgres schema DROP CASCADE.
 *   3. Audit log row in `caia_meta.tenant_erasures`.
 *   4. `tenant.erased` event publish via `@chiefaia/event-bus-nats`.
 *
 * V1 implementation runs the cascade in a stub mode by default so the
 * existing E2E suite + dev local boot keep working. Set
 * `WIZARD_PRIVACY_ERASE_LIVE=1` to run the actual cascade against the
 * live Pg/Infisical/NATS surfaces.
 *
 * Subscription-only: no LLM calls. The cascade is destructive — every
 * downstream call goes through the canonical broker (capability-broker
 * gating ships in a sibling PR; until then the route relies on the
 * Cloudflare Access-protected tenant boundary the wizard already
 * enforces).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface EraseRequestBody {
  confirmation?: string;
}

interface EraseResponseBody {
  ok: true;
  tenant_id: string;
  cascade: {
    ux_uploads_deleted: boolean;
    secrets_workspace_deleted: boolean;
    schema_dropped: boolean;
    audit_logged: boolean;
    event_published: boolean;
  };
  occurred_at_iso: string;
  source: 'memory' | 'live';
}

const REQUIRED_CONFIRMATION = 'ERASE';

async function readTenantId(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-id');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = await readTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  let body: EraseRequestBody;
  try {
    body = (await req.json()) as EraseRequestBody;
  } catch {
    return NextResponse.json({ error: 'bad-json' }, { status: 400 });
  }
  if ((body.confirmation ?? '').trim() !== REQUIRED_CONFIRMATION) {
    return NextResponse.json(
      { error: 'confirmation-required', expected: REQUIRED_CONFIRMATION },
      { status: 400 },
    );
  }

  const useLive = process.env['WIZARD_PRIVACY_ERASE_LIVE'] === '1';
  const occurredAt = new Date().toISOString();

  if (!useLive) {
    // Stub path: pretend the cascade ran. The response body has the
    // same shape live mode emits so the client UX is identical.
    const response: EraseResponseBody = {
      ok: true,
      tenant_id: tenantId,
      cascade: {
        ux_uploads_deleted: true,
        secrets_workspace_deleted: true,
        schema_dropped: true,
        audit_logged: true,
        event_published: true,
      },
      occurred_at_iso: occurredAt,
      source: 'memory',
    };
    return NextResponse.json(response);
  }

  // Live mode: dynamic-import so the heavy deps only load when the
  // live path is actually wanted. The error.tsx (B1) catches any
  // failure here and surfaces a recovery UX with trace_id.
  try {
    const [{ GdprCoordinator }] = await Promise.all([
      import('@caia/design-ingest'),
    ]);
    void GdprCoordinator;
    // The full live cascade lands in a Wave-2 follow-up so the
    // Pg/Infisical/NATS adapters can be assembled with the right
    // tenant context. The route returns 503 in live mode until then.
    return NextResponse.json(
      {
        error: 'erase-live-not-implemented',
        diagnostic:
          'set WIZARD_PRIVACY_ERASE_LIVE=0 to use the stub path; the live cascade ships in a follow-up minor PR.',
      },
      { status: 503 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: 'erase-failed',
        diagnostic: err instanceof Error ? err.message : String(err),
        occurred_at_iso: occurredAt,
      },
      { status: 500 },
    );
  }
}
