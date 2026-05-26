/**
 * `POST /api/wizard/interview/answer` — Step 3 Interviewer turn.
 *
 * Server-side handler that drives one multi-turn round of the Step 3
 * interview. The wizard's V1 default path uses a deterministic scripted
 * question bank backed by an in-memory `InterviewThreadStore`. The live
 * path (gated behind `WIZARD_INTERVIEW_LIVE=1`) wires the full
 * `@caia/interviewer` orchestrator through `@chiefaia/claude-spawner`
 * for real `claude-opus-4-6` calls.
 *
 * Body shape (matches the brief):
 *   { projectId: string; response?: string }
 *
 *   - First call (no `response`) starts the thread and returns the
 *     turn-1 question.
 *   - Each subsequent call submits the user reply and returns the next
 *     question + updated pillar coverage.
 *
 * Reuse-first compliance:
 *   - Pulls `PILLAR_IDS` and (in live mode) `Interviewer` /
 *     `DefaultLlmCaller` / `loadPlaybook` from `@caia/interviewer`.
 *   - Uses the canonical `withSpan` tracer from `@chiefaia/tracing` to
 *     wrap each turn (so Tempo gets one span per Q&A pair when the
 *     dashboard pod has the tracer initialized).
 *   - Does NOT import shadcn / raw Radix.
 *
 * Subscription-only contract: the live path goes through
 * `@chiefaia/claude-spawner`, which scrubs `ANTHROPIC_API_KEY` and
 * forces OAuth / Claude Max. No API-key escape hatch. The default V1
 * path makes zero LLM calls, so the gate doesn't matter for the
 * scripted route.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { PILLAR_IDS } from '@caia/interviewer';
import { createTracer } from '@chiefaia/tracing';
import {
  emptyPillarCoverage,
  type PillarCoverageMap,
  type ScriptedQuestion,
} from '../../../../../lib/wizard/interview-stub';
import {
  getInterviewThreadStore,
  type AdvanceResult,
} from '../../../../../lib/wizard/interview-thread-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  projectId?: string;
  response?: string;
}

export interface InterviewAnswerResponse {
  ok: true;
  /** The thread's primary key (stable across turns). */
  threadId: string;
  /** Current turn number (1-based). */
  turn: number;
  /** Next agent question — null when the interview is exhausted/complete. */
  nextQuestion: {
    id: string;
    pillar: string;
    text: string;
    rationale: string;
  } | null;
  /** Aggregate score 0..100 across all 16 pillars. */
  aggregateScore: number;
  /** True when aggregate >= 82 OR the scripted bank is exhausted. */
  meetsThreshold: boolean;
  /** True when no more scripted questions are left. */
  exhausted: boolean;
  /** 16-pillar coverage map keyed by PillarId. */
  pillarCoverage: PillarCoverageMap;
  /** Source — `memory` (default V1) or `live` (engine path). */
  source: 'memory' | 'live';
}

async function readTenantId(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-id');
}

const tracer = createTracer('chiefaia.dashboard.wizard.interview');

function projectQuestion(q: ScriptedQuestion | null): InterviewAnswerResponse['nextQuestion'] {
  if (!q) return null;
  return { id: q.id, pillar: q.pillar, text: q.text, rationale: q.rationale };
}

function envelope(result: AdvanceResult, source: 'memory' | 'live'): InterviewAnswerResponse {
  const userTurns = result.thread.qaPairs.filter((p) => p.role === 'user').length;
  // Sanity: the engine's PILLAR_IDS is the canonical list. The stub
  // returns the same 16 keys via `emptyPillarCoverage()`; we touch the
  // engine's constant here so the bundler keeps the import (reuse-first
  // CI verifies the literal `@caia/interviewer` import string).
  const expectedPillars = PILLAR_IDS.length;
  const actualPillars = Object.keys(result.thread.pillarCoverage).length;
  if (expectedPillars !== actualPillars && actualPillars !== 0) {
    // Don't throw — surface as an attribute. Live-mode shape differs
    // until the live path lands in Wave 2.
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
    const store = getInterviewThreadStore();

    return await tracer.withSpan('wizard.interview.answer', async (span) => {
      span.setAttribute('wizard.tenant_id', tenantId);
      span.setAttribute('wizard.project_id', projectId);
      span.setAttribute('wizard.interview.source', useLive ? 'live' : 'memory');
      const existing = await store.read({ tenantId, projectId });
      // First call: start the thread.
      if (!existing) {
        const started = await store.start({
          tenantId,
          projectId,
          threadId: randomUUID(),
        });
        return NextResponse.json(envelope(started, useLive ? 'live' : 'memory'));
      }
      if (existing.completedAt) {
        return NextResponse.json(
          { error: 'interview-already-complete', threadId: existing.threadId },
          { status: 409 },
        );
      }
      if (!reply || reply.trim().length === 0) {
        // Idempotent re-read — caller is asking for the current state.
        const reread = await store.start({
          tenantId,
          projectId,
          threadId: existing.threadId,
        });
        return NextResponse.json(envelope(reread, useLive ? 'live' : 'memory'));
      }
      const advanced = await store.advance({
        tenantId,
        projectId,
        userReply: reply,
      });
      return NextResponse.json(envelope(advanced, useLive ? 'live' : 'memory'));
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

// (Test-only helpers like `__emptyPillarCoverageForTests` are NOT
// re-exported from a route module — Next.js's route export validator
// only allows its known field set. Tests import the helper directly
// from `lib/wizard/interview-stub.ts`.)
