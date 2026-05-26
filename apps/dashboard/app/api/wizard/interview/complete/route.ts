/**
 * `POST /api/wizard/interview/complete` — finalise the Step 3 interview.
 *
 * Fired either by the customer hitting "I'm done" in `InterviewerChat`,
 * or by the critic (in live mode) deciding coverage is sufficient
 * (engine reached `HANDOFF`). Both paths flow through this single
 * server-side handler so the FSM dispatch is one code path.
 *
 * Flow:
 *   1. Read `x-tenant-id` from the middleware-set header.
 *   2. Parse `{ projectId, force? }`.
 *   3. Validate completeness — aggregate score across all 16 pillars
 *      must be ≥ 82 (engine spec §5 threshold) UNLESS `force: true` is
 *      passed (operator override, mirroring the engine's `forceClose`
 *      semantic).
 *   4. Dispatch FSM transition `interviewing → interview-complete` via
 *      the canonical `@caia/state-machine` `StateMachine.transition()`
 *      (same path used by the existing PATCH state route from PR #601,
 *      kept in-process here so the completeness gate + transition are
 *      atomic).
 *   5. Mark the in-memory thread `completedAt` so subsequent
 *      `/api/wizard/interview/answer` calls return 409.
 *
 * Reuse-first compliance:
 *   - Uses `@caia/state-machine` for FSM transition + `canTransition`
 *     check (no inline FSM logic).
 *   - Uses `getStateStoreForTenant` from `lib/wizard/store-wire.ts`,
 *     the same factory the PATCH state route uses.
 *   - Re-uses `getInterviewThreadStore` (the shared singleton) so the
 *     completeness check + the mark-complete write are against the
 *     same row the answer route writes.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { canTransition, type ProjectState } from '@caia/state-machine';
import { createTracer } from '@chiefaia/tracing';
import { getStateStoreForTenant } from '../../../../../lib/wizard/store-wire';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  projectId?: string;
  /**
   * Operator override — set to true to bypass the aggregate-score
   * threshold (mirrors `Interviewer.forceClose`). Useful when the
   * customer wants to advance with partial coverage.
   */
  force?: boolean;
}

const tracer = createTracer('chiefaia.dashboard.wizard.interview');

const TARGET_STATE: ProjectState = 'interview-complete';

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

    const store = getInterviewThreadStore();
    const thread = await store.read({ tenantId, projectId });
    if (!thread) {
      return NextResponse.json(
        { error: 'no-thread', detail: 'start an interview before completing' },
        { status: 404 },
      );
    }
    if (thread.completedAt) {
      return NextResponse.json(
        {
          ok: true,
          alreadyComplete: true,
          threadId: thread.threadId,
          completedAt: thread.completedAt,
        },
        { status: 200 },
      );
    }

    // 1) Completeness gate (unless force).
    //
    // Either path passes:
    //   (a) aggregate score across pillars >= 82 (engine spec §5), OR
    //   (b) the customer has exhausted the scripted question bank —
    //       in V1 that means they answered every available question and
    //       there's nothing left to ask. Treat that as "done with what
    //       we could ask" since the live critic path (Wave 2) is what
    //       enforces the strict score floor; the wizard V1 stub bank
    //       deliberately spans only a subset of pillars, so requiring
    //       the full 82 here would make the gate unreachable without
    //       force.
    const score = aggregateScore(thread.pillarCoverage);
    const userTurnCount = thread.qaPairs.filter((p) => p.role === 'user').length;
    const isExhausted = userTurnCount >= totalScriptedTurns();
    span.setAttribute('wizard.interview.aggregate_score', score);
    span.setAttribute('wizard.interview.threshold', COMPLETE_THRESHOLD);
    span.setAttribute('wizard.interview.exhausted', isExhausted);
    if (!force && score < COMPLETE_THRESHOLD && !isExhausted) {
      return NextResponse.json(
        {
          error: 'coverage-below-threshold',
          aggregateScore: score,
          threshold: COMPLETE_THRESHOLD,
          exhausted: isExhausted,
        },
        { status: 412 },
      );
    }

    // 2) Resolve the project's current state and check the FSM edge.
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
      snapshot = await getWizardState(projectId, { store: stateStore });
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
      // Idempotent: already advanced, just mark the thread.
      await store.markComplete({ tenantId, projectId });
      return NextResponse.json(
        {
          ok: true,
          alreadyAdvanced: true,
          threadId: thread.threadId,
          state: snapshot.state,
        },
        { status: 200 },
      );
    }

    if (!canTransition(snapshot.state, TARGET_STATE)) {
      return NextResponse.json(
        {
          error: 'invalid-transition',
          from: snapshot.state,
          to: TARGET_STATE,
        },
        { status: 409 },
      );
    }

    // 3) Dispatch — same shape as the PATCH state route.
    try {
      const { StateMachine } = await import('@caia/state-machine');
      const sm = new (StateMachine as unknown as new (opts: { store: unknown }) => {
        transition(
          projectId: string,
          target: ProjectState,
          opts?: { reason?: string },
        ): Promise<unknown>;
      })({ store: stateStore });
      await sm.transition(projectId, TARGET_STATE, {
        reason: force ? 'operator-force-close' : 'critic-coverage-sufficient',
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: 'transition-failed',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }

    // 4) Mark the thread complete so future answer-route calls 409.
    const completed = await store.markComplete({ tenantId, projectId });

    return NextResponse.json(
      {
        ok: true,
        threadId: completed.threadId,
        state: TARGET_STATE,
        aggregateScore: score,
        completedAt: completed.completedAt,
        forced: force,
      },
      { status: 200 },
    );
  });
}
