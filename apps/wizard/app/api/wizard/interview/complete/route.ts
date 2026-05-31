/**
 * `POST /api/wizard/interview/complete` — finalise the Step 3 interview.
 *
 * Phase B B7 (2026-05-31): the FSM transition runs under
 * `wizardWithRetry` so transient failures retry with 30s/60s/120s
 * backoff. On final retry exhaustion the route best-effort transitions
 * the project to `interviewing-failed` via `@caia/state-machine` so the
 * UI shows an explicit error state.
 *
 * Phase B B4 (2026-05-31): the FSM dispatch + thread mark-complete now
 * run inside `withTenantSearchPath` so the per-tenant schema is pinned
 * for the duration of the transition. The `StateMachine.transition` call
 * goes via `@caia/state-machine`'s `transitionAtomic`, which opens its
 * own inner transaction — we therefore RELEASE the outer search_path
 * wrapper around it (the inner BEGIN is a new transaction the helper
 * doesn't own). The thread-store work that wraps the transition is
 * pure in-memory in V1, so the pinning is forward-compat for the live
 * path.
 *
 * Phase B B3 (2026-05-31): the FSM transition dispatch is also wrapped
 * in `withClaudeSpawnerSpan` so Tempo carries the wizard step
 * attributes (`caia.wizard.step=interview.complete`, project_id,
 * prompt_template, model). In V1 no claude call happens here — the
 * `caia.claude.live=false` extra makes that visible in Tempo. When the
 * Wave 2 live critic-coverage decision drops into this path, the inner
 * `claude.spawn` span will be parented under the wizard wrapper
 * automatically via the OTel context manager.
 *
 * Reuse-first compliance:
 *   - Uses `@caia/state-machine`'s `canTransition` + `StateMachine`.
 *   - Uses `getStateStoreForTenant` from `lib/wizard/store-wire.ts`.
 *   - Uses `withTenantSearchPath` from `lib/tenants/search-path.ts`.
 *   - Uses `withClaudeSpawnerSpan` from `@chiefaia/tracing`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { canTransition, type ProjectState } from '@caia/state-machine';
import { createTracer, withClaudeSpawnerSpan } from '@chiefaia/tracing';
import {
  getStateStoreForTenant,
  resolveTenantSchema,
} from '../../../../../lib/wizard/store-wire';
import {
  getWizardState,
  ProjectNotFoundError,
} from '../../../../../lib/wizard/state.server';
import { getInterviewThreadStore } from '../../../../../lib/wizard/interview-thread-store';
import {
  aggregateScore,
  COMPLETE_THRESHOLD,
  totalScriptedTurns,
} from '../../../../../lib/wizard/interview-stub';
import { getPool } from '../../../../../lib/tenants/wire';
import { withTenantSearchPath } from '../../../../../lib/tenants/search-path';
import { wizardWithRetry } from '../../../../../lib/wizard/retry-spawner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  projectId?: string;
  force?: boolean;
}

const tracer = createTracer('chiefaia.dashboard.wizard.interview');

const TARGET_STATE: ProjectState = 'interview-complete';
const FAILURE_STATE: ProjectState = 'interviewing-failed';

/** Best-effort transition to `interviewing-failed` after retry exhaustion. */
async function transitionToFailure(
  stateStore: unknown,
  projectId: string,
  reason: string,
): Promise<void> {
  try {
    const { StateMachine } = await import('@caia/state-machine');
    const sm = new (StateMachine as unknown as new (opts: { store: unknown }) => {
      transition(
        projectId: string,
        target: ProjectState,
        opts?: { reason?: string },
      ): Promise<unknown>;
    })({ store: stateStore });
    await sm.transition(projectId, FAILURE_STATE, { reason });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[wizard.interview.complete] failed to record interviewing-failed state: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

/** Claude model the live critic-coverage decision uses (Wave 2). */
const COMPLETE_LIVE_MODEL = 'claude-opus-4-6';

/** Prompt template the critic-coverage path invokes (Wave 2). */
const COMPLETE_PROMPT_TEMPLATE = 'critic:coverage-decision.v1';

async function readTenantId(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-id');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = await readTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'bad-json' }, { status: 400 });
  }
  if (!body.projectId) {
    return NextResponse.json({ error: 'projectId-required' }, { status: 400 });
  }
  const projectId = body.projectId;
  const force = body.force === true;

  return await tracer.withSpan('wizard.interview.complete', async (span) => {
    span.setAttribute('wizard.tenant_id', tenantId);
    span.setAttribute('wizard.project_id', projectId);
    span.setAttribute('wizard.interview.force', force);

    // Phase B B4: resolve tenant schema up-front so a malformed tenant
    // never gets past authn.
    let tenantSchema: string;
    try {
      tenantSchema = await resolveTenantSchema(tenantId);
    } catch (err) {
      return NextResponse.json(
        {
          error: 'tenant-schema-failed',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }
    span.setAttribute('wizard.tenant_schema', tenantSchema);

    const store = getInterviewThreadStore();

    // ----- Pre-check: thread state + coverage gate. Run inside a
    // search-path-pinned transaction so future pg-backed checks resolve
    // against the right schema. -----
    type PreCheckResult =
      | { kind: 'response'; status: number; body: Record<string, unknown> }
      | {
          kind: 'proceed';
          score: number;
          threadId: string;
        };

    let pre: PreCheckResult;
    try {
      pre = await withTenantSearchPath<PreCheckResult>(
        getPool(),
        tenantSchema,
        async () => {
          const thread = await store.read({ tenantId, projectId });
          if (!thread) {
            return {
              kind: 'response',
              status: 404,
              body: { error: 'no-thread', detail: 'start an interview before completing' },
            };
          }
          if (thread.completedAt) {
            return {
              kind: 'response',
              status: 200,
              body: {
                ok: true,
                alreadyComplete: true,
                threadId: thread.threadId,
                completedAt: thread.completedAt,
              },
            };
          }

          const score = aggregateScore(thread.pillarCoverage);
          const userTurnCount = thread.qaPairs.filter((p) => p.role === 'user').length;
          const isExhausted = userTurnCount >= totalScriptedTurns();
          span.setAttribute('wizard.interview.aggregate_score', score);
          span.setAttribute('wizard.interview.threshold', COMPLETE_THRESHOLD);
          span.setAttribute('wizard.interview.exhausted', isExhausted);
          if (!force && score < COMPLETE_THRESHOLD && !isExhausted) {
            return {
              kind: 'response',
              status: 412,
              body: {
                error: 'coverage-below-threshold',
                aggregateScore: score,
                threshold: COMPLETE_THRESHOLD,
                exhausted: isExhausted,
              },
            };
          }
          return { kind: 'proceed', score, threadId: thread.threadId };
        },
      );
    } catch (err) {
      return NextResponse.json(
        {
          error: 'precheck-failed',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }

    if (pre.kind === 'response') {
      return NextResponse.json(pre.body, { status: pre.status });
    }

    // ----- Resolve state store + current snapshot. We pin search_path
    // again because the state-machine schema queries don't share the
    // outer transaction (PgStateStore.transitionAtomic opens its own
    // BEGIN). -----
    let stateStore;
    try {
      stateStore = await getStateStoreForTenant(tenantId);
    } catch (err) {
      return NextResponse.json(
        {
          error: 'state-store-failed',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }

    let snapshot;
    try {
      snapshot = await withTenantSearchPath(getPool(), tenantSchema, async () => {
        return getWizardState(projectId, { store: stateStore });
      });
    } catch (err) {
      if (err instanceof ProjectNotFoundError) {
        return NextResponse.json({ error: 'project-not-found', projectId }, { status: 404 });
      }
      return NextResponse.json(
        {
          error: 'state-lookup-failed',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }

    if (snapshot.state === TARGET_STATE) {
      await withTenantSearchPath(getPool(), tenantSchema, async () => {
        await store.markComplete({ tenantId, projectId });
      });
      return NextResponse.json(
        {
          ok: true,
          alreadyAdvanced: true,
          threadId: pre.threadId,
          state: snapshot.state,
        },
        { status: 200 },
      );
    }

    if (!canTransition(snapshot.state, TARGET_STATE)) {
      return NextResponse.json(
        { error: 'invalid-transition', from: snapshot.state, to: TARGET_STATE },
        { status: 409 },
      );
    }

    // The FSM dispatch happens OUTSIDE our search_path wrapper because
    // PgStateStore.transitionAtomic opens its own transaction. Its own
    // queries are schema-qualified against `caia_meta`, so they don't
    // need the tenant search_path; only the post-step thread-store
    // write does, and we wrap it below.
    //
    // Phase B B3: wrap the FSM transition (which the Wave 2 path will
    // extend with a live critic-coverage claude-spawner call) with
    // `withClaudeSpawnerSpan`. In V1 no claude call happens here —
    // the `caia.claude.live=false` extra makes that visible in Tempo
    // for rollout A/B comparisons.
    // B7: wrap the FSM transition (and live-mode critic call) under
    // the retry envelope. On final retry exhaustion we transition to
    // `interviewing-failed`.
    const retryResult = await wizardWithRetry<void>(
      { key: { tenantId, projectId }, step: 'interview.complete' },
      async () => {
        const { StateMachine } = await import('@caia/state-machine');
        const sm = new (StateMachine as unknown as new (opts: { store: unknown }) => {
          transition(
            projectId: string,
            target: ProjectState,
            opts?: { reason?: string },
          ): Promise<unknown>;
        })({ store: stateStore });
        await withClaudeSpawnerSpan(
          {
            step: 'interview.complete',
            projectId,
            tenantId,
            promptTemplate: COMPLETE_PROMPT_TEMPLATE,
            model: COMPLETE_LIVE_MODEL,
            extra: {
              'caia.claude.live': false,
              'caia.wizard.interview.force': force,
            },
          },
          async () =>
            sm.transition(projectId, TARGET_STATE, {
              reason: force ? 'operator-force-close' : 'critic-coverage-sufficient',
            }),
        );
        return { ok: true, value: undefined };
      },
    );

    span.setAttribute('caia.retry.attempts_run', retryResult.attemptsRun);
    span.setAttribute('caia.retry.final_class', retryResult.finalErrorClass ?? 'none');

    if (!retryResult.ok) {
      await transitionToFailure(
        stateStore,
        projectId,
        `interview-complete retry exhausted: ${retryResult.diagnostic ?? 'unknown'}`,
      );
      return NextResponse.json(
        {
          error: 'interview-complete-retry-exhausted',
          attemptsRun: retryResult.attemptsRun,
          errorClass: retryResult.finalErrorClass,
          detail: retryResult.diagnostic,
          failureState: FAILURE_STATE,
        },
        { status: 503 },
      );
    }

    const completed = await withTenantSearchPath(getPool(), tenantSchema, async () => {
      return store.markComplete({ tenantId, projectId });
    });

    return NextResponse.json(
      {
        ok: true,
        threadId: completed.threadId,
        state: TARGET_STATE,
        aggregateScore: pre.score,
        completedAt: completed.completedAt,
        forced: force,
        attemptsRun: retryResult.attemptsRun,
      },
      { status: 200 },
    );
  });
}
