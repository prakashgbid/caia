/**
 * `GET/PATCH /api/wizard/[projectId]/state` — wizard state REST.
 *
 *   GET   → WizardStateSnapshot (server reads @caia/state-machine store)
 *   PATCH → request a transition to `targetState`, validated by the FSM.
 *
 * Tenant isolation (Phase B B4): every pg-touching block is wrapped with
 * `withTenantSearchPath` so the per-tenant search_path is scoped to the
 * transaction.
 *
 * FSM lifecycle events (Phase B B5): the PATCH route wraps the
 * `StateMachine.transition()` call with `withFsmPublish` so every FSM
 * transition publishes `wizard.step.{transitioning,completed,failed}`
 * on NATS via `@chiefaia/event-bus-nats`.
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
import {
  getStateStoreForTenant,
  resolveTenantSchema,
} from '../../../../../lib/wizard/store-wire';
import { getFsmPublisher, getPool } from '../../../../../lib/tenants/wire';
import { withTenantSearchPath } from '../../../../../lib/tenants/search-path';
import { withFsmPublish } from '../../../../../lib/wizard/fsm-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    const tenantSchema = await resolveTenantSchema(tenantId);
    const store = await getStateStoreForTenant(tenantId);
    const snapshot = await withTenantSearchPath(getPool(), tenantSchema, async () => {
      return getWizardState(projectId, { store });
    });
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
    const tenantSchema = await resolveTenantSchema(tenantId);
    const store = await getStateStoreForTenant(tenantId);
    const publisher = await getFsmPublisher();
    const next = await withTenantSearchPath(getPool(), tenantSchema, async () => {
      const snapshot = await getWizardState(projectId, { store });
      if (!canTransition(snapshot.state, body.targetState as ProjectState)) {
        throw new InvalidTransitionError(snapshot.state, body.targetState as ProjectState);
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
      // Wrap the FSM call with the B5 NATS lifecycle publish ring.
      await withFsmPublish(
        {
          publisher,
          projectId,
          fromState: snapshot.state,
          toState: body.targetState as ProjectState,
          tenantSchema,
          actor: 'api',
        },
        () => sm.transition(projectId, body.targetState as ProjectState, { reason: body.reason }),
      );
      return getWizardState(projectId, { store });
    });
    return NextResponse.json(next);
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: 'not-found', projectId }, { status: 404 });
    }
    if (err instanceof InvalidTransitionError) {
      return NextResponse.json(
        { error: 'invalid-transition', from: err.from, to: err.to },
        { status: 409 },
      );
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

/**
 * Internal-only — surfaces an FSM "this is not a legal edge" rejection
 * out of the `withTenantSearchPath` callback so the wrapper can roll the
 * transaction back. Caught at the outer try/catch and translated to a
 * 409 response.
 */
class InvalidTransitionError extends Error {
  constructor(public readonly from: ProjectState, public readonly to: ProjectState) {
    super(`invalid-transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}
