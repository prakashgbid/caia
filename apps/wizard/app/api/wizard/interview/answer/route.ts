/**
 * `POST /api/wizard/interview/answer` — Step 3 Interviewer turn.
 *
 * Server-side handler that drives one multi-turn round of the Step 3
 * interview.
 *
 * Phase B B4 (2026-05-31): when the route runs against a backing
 * Postgres-backed thread store (live mode), every pg-touching read +
 * write is wrapped in `withTenantSearchPath` so the tenant's schema is
 * pinned for the transaction. The default V1 path uses the in-memory
 * thread store and therefore makes zero pg calls — we skip the wrap
 * there to avoid acquiring a pool client we'd never use.
 *
 * Phase B B3 (2026-05-31): the (transitive) claude-spawner call site
 * is wrapped in `withClaudeSpawnerSpan` so Tempo sees a
 * `claude.spawn.wizard` child span carrying `caia.wizard.step`,
 * `caia.wizard.project_id`, `caia.claude.prompt_template`, and
 * `caia.claude.model`. The OTel context manager threads the wizard
 * span as the parent of the inner `claude.spawn` span the spawner
 * emits — W3C TraceContext flows through to Tempo end-to-end.
 *
 * Reuse-first compliance:
 *   - Pulls `PILLAR_IDS` from `@caia/interviewer`.
 *   - Uses `withSpan` + `withClaudeSpawnerSpan` from `@chiefaia/tracing`.
 *   - Uses `withTenantSearchPath` from `lib/tenants/search-path.ts`
 *     (live path only — see note above).
 *
 * Subscription-only contract preserved: no API-key escape hatch.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { PILLAR_IDS } from '@caia/interviewer';
import { createTracer, withClaudeSpawnerSpan } from '@chiefaia/tracing';
import {
  emptyPillarCoverage,
  type PillarCoverageMap,
  type ScriptedQuestion,
} from '../../../../../lib/wizard/interview-stub';
import {
  getInterviewThreadStore,
  type AdvanceResult,
} from '../../../../../lib/wizard/interview-thread-store';
import { withTenantSearchPath } from '../../../../../lib/tenants/search-path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  projectId?: string;
  response?: string;
}

export interface InterviewAnswerResponse {
  ok: true;
  threadId: string;
  turn: number;
  nextQuestion: {
    id: string;
    pillar: string;
    text: string;
    rationale: string;
  } | null;
  aggregateScore: number;
  meetsThreshold: boolean;
  exhausted: boolean;
  pillarCoverage: PillarCoverageMap;
  source: 'memory' | 'live';
}

async function readTenantId(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-id');
}

const tracer = createTracer('chiefaia.dashboard.wizard.interview');

/**
 * Claude model the live interviewer path uses. Hard-coded here so the
 * span's `caia.claude.model` attribute matches what the engine
 * ultimately spawns. Wave 2 may surface this via env / config.
 */
const INTERVIEW_LIVE_MODEL = 'claude-opus-4-6';

/**
 * Prompt template identifier the wizard interviewer step invokes. Used
 * for Tempo filtering when one wizard step issues several prompts —
 * here it's a single deterministic playbook lookup per turn.
 */
const INTERVIEW_PROMPT_TEMPLATE = 'interviewer:playbook.v1';

function projectQuestion(q: ScriptedQuestion | null): InterviewAnswerResponse['nextQuestion'] {
  if (!q) return null;
  return { id: q.id, pillar: q.pillar, text: q.text, rationale: q.rationale };
}

function envelope(result: AdvanceResult, source: 'memory' | 'live'): InterviewAnswerResponse {
  const userTurns = result.thread.qaPairs.filter((p) => p.role === 'user').length;
  const expectedPillars = PILLAR_IDS.length;
  const actualPillars = Object.keys(result.thread.pillarCoverage).length;
  if (expectedPillars !== actualPillars && actualPillars !== 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[wizard.interview] pillar count drift: expected=${expectedPillars} actual=${actualPillars}`,
    );
  }
  return {
    ok: true,
    threadId: result.thread.threadId,
    turn: userTurns + 1,
    nextQuestion: projectQuestion(result.nextQuestion),
    aggregateScore: result.aggregateScore,
    meetsThreshold: result.meetsThreshold,
    exhausted: result.exhausted,
    pillarCoverage: result.thread.pillarCoverage,
    source,
  };
}

// Keep `emptyPillarCoverage` referenced so tree-shaking doesn't drop
// the helper from the bundle in the unused-import lint pass.
void emptyPillarCoverage;

/**
 * Run the thread-store work for a request. When `tenantSchema` is
 * provided we wrap the body in `withTenantSearchPath` so any pg queries
 * inside the live thread store target the tenant's schema. When it's
 * `null` (V1 in-memory mode) we run the body directly — there are no
 * SQL calls to scope, and acquiring a pool client would be wasted work.
 */
async function runStoreWork<T>(
  tenantSchema: string | null,
  body: () => Promise<T>,
): Promise<T> {
  if (!tenantSchema) return body();
  // Lazy-load pg wiring only when we actually need it. Keeps the
  // in-memory test path from importing `pg`/`@caia/state-machine`.
  const { getPool } = await import('../../../../../lib/tenants/wire');
  return withTenantSearchPath(getPool(), tenantSchema, () => body());
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
  const reply = body.response;

  const useLive = process.env['WIZARD_INTERVIEW_LIVE'] === '1';

  try {
    // Phase B B4: resolve tenant schema ONLY when we'll use it (live
    // mode). The V1 in-memory thread store doesn't touch pg, so a
    // resolveTenantSchema lookup would be wasted work and would break
    // unit tests that don't have a global `tenants` table mocked.
    let tenantSchema: string | null = null;
    if (useLive) {
      const { resolveTenantSchema } = await import('../../../../../lib/wizard/store-wire');
      tenantSchema = await resolveTenantSchema(tenantId);
    }
    const store = getInterviewThreadStore();

    return await tracer.withSpan('wizard.interview.answer', async (span) => {
      span.setAttribute('wizard.tenant_id', tenantId);
      span.setAttribute('wizard.project_id', projectId);
      span.setAttribute('wizard.interview.source', useLive ? 'live' : 'memory');
      if (tenantSchema) span.setAttribute('wizard.tenant_schema', tenantSchema);

      // Phase B B3: every store mutation is wrapped in
      // `withClaudeSpawnerSpan` so the span tree carries the wizard
      // step attributes regardless of whether the underlying store is
      // the V1 in-memory stub or the Wave 2 live engine that fans out
      // to `@chiefaia/claude-spawner`. The `caia.claude.live`
      // attribute lets operators A/B the rollout in Tempo.
      const wrapClaude = <T,>(turn: number, fn: () => Promise<T>): Promise<T> =>
        withClaudeSpawnerSpan(
          {
            step: 'interview.answer',
            projectId,
            tenantId,
            promptTemplate: INTERVIEW_PROMPT_TEMPLATE,
            model: INTERVIEW_LIVE_MODEL,
            turn,
            extra: { 'caia.claude.live': useLive },
          },
          fn,
        );

      const result = await runStoreWork(tenantSchema, async () => {
        const existing = await store.read({ tenantId, projectId });
        if (!existing) {
          return {
            kind: 'envelope' as const,
            body: envelope(
              await wrapClaude(1, () =>
                store.start({ tenantId, projectId, threadId: randomUUID() }),
              ),
              useLive ? 'live' : 'memory',
            ),
          };
        }
        if (existing.completedAt) {
          return {
            kind: 'error' as const,
            status: 409,
            body: { error: 'interview-already-complete', threadId: existing.threadId },
          };
        }
        if (!reply || reply.trim().length === 0) {
          const currentTurn =
            existing.qaPairs.filter((p) => p.role === 'user').length + 1;
          return {
            kind: 'envelope' as const,
            body: envelope(
              await wrapClaude(currentTurn, () =>
                store.start({ tenantId, projectId, threadId: existing.threadId }),
              ),
              useLive ? 'live' : 'memory',
            ),
          };
        }
        const nextTurn = existing.qaPairs.filter((p) => p.role === 'user').length + 1;
        return {
          kind: 'envelope' as const,
          body: envelope(
            await wrapClaude(nextTurn, () =>
              store.advance({ tenantId, projectId, userReply: reply }),
            ),
            useLive ? 'live' : 'memory',
          ),
        };
      });

      if (result.kind === 'error') {
        return NextResponse.json(result.body, { status: result.status });
      }
      return NextResponse.json(result.body);
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'interview-advance-failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
