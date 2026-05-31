/**
 * `GET/PATCH /api/wizard/[projectId]/state` — wizard state REST.
 *
 *   GET   → WizardStateSnapshot (server reads @caia/state-machine store)
 *   PATCH → request a transition to `targetState`, validated by the FSM.
 *
 * Tenant isolation: every request must have a `x-tenant-id` header from
 * the middleware. We don't (yet) verify that the project belongs to the
 * tenant — that check happens inside the per-tenant Postgres schema (the
 * StateStore is constructed against the tenant's schema, so a foreign
 * project_id simply returns "not found"). Follow-up PR will add the
 * explicit cross-tenant audit log.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import {
  canTransition,
  type ProjectState,
} from '@caia/state-machine';
import {
  getWizardState,
  ProjectNotFoundError,
} from '../../../../../lib/wizard/state.server';
import { getStateStoreForTenant } from '../../../../../lib/wizard/store-wire';
import { withFsmPublish } from '../../../../../lib/wizard/fsm-events';
import { getFsmPublisher, getPool } from '../../../../../lib/tenants/wire';
import type { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


async function resolveTenantSchema(tenantId: string): Promise<string> {
  const pool: Pool = getPool();
  const r = await pool.query(
    'SELECT schema_name FROM tenants WHERE tenant_id = $1 LIMIT 1',
    [tenantId],
  );
  if (r.rowCount === 0) throw new Error('tenant-not-found');
  return String(r.rows[0].schema_name);
}

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

async function readTenantId(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-id');
}

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const tenantId = await readTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { projectId } = await Promise.resolve(ctx.params);
  try {
    const store = await getStateStoreForTenant(tenantId);
    const snapshot = await getWizardState(projectId, { store });
    return NextResponse.json(snapshot);
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: 'not-found', projectId }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'lookup-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface PatchBody {
  targetState?: ProjectState;
  reason?: string;
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const tenantId = await readTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { projectId } = await Promise.resolve(ctx.params);

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'bad-json' }, { status: 400 });
  }
  if (!body.targetState) {
    return NextResponse.json({ error: 'targetState-required' }, { status: 400 });
  }

  try {
    const store = await getStateStoreForTenant(tenantId);
    const snapshot = await getWizardState(projectId, { store });
    if (!canTransition(snapshot.state, body.targetState)) {
      return NextResponse.json(
        {
          error: 'invalid-transition',
          from: snapshot.state,
          to: body.targetState,
        },
        { status: 409 },
      );
    }
    // The actual transition is delegated to @caia/state-machine's
    // StateMachine.transition(). We construct it on-demand here.
    const { StateMachine } = await import('@caia/state-machine');
    const sm = new (StateMachine as unknown as new (opts: { store: unknown }) => {
      transition(
        projectId: string,
        target: ProjectState,
        opts?: { reason?: string },
      ): Promise<unknown>;
    })({ store });
    const publisher = await getFsmPublisher();
    const tenantSchema = await resolveTenantSchema(tenantId);
    await withFsmPublish(
      {
        publisher,
        projectId,
        fromState: snapshot.state,
        toState: body.targetState,
        tenantSchema,
        actor: 'api',
      },
      () => sm.transition(projectId, body.targetState as ProjectState, { reason: body.reason }),
    );
    const next = await getWizardState(projectId, { store });
    return NextResponse.json(next);
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: 'not-found', projectId }, { status: 404 });
    }
    return NextResponse.json(
      {
        error: 'transition-failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
