/**
 * Pipeline driver — runs a prompt through the canonical Phase 2
 * stages synchronously so a deterministic regression test can assert
 * each transition.
 *
 * Mirrors the production scaffolder's then-chain (see
 * `apps/orchestrator/src/agents/scaffolder.ts`) but with explicit
 * awaits and configurable per-stage options (e.g. inject a custom
 * judge into the validator loop).
 */

import { eq } from 'drizzle-orm';
import { prompts } from '../../../src/db/schema';
import { runPOAgent } from '../../../src/agents/po-agent';
import { runBAAgent } from '../../../src/agents/ba-agent';
import type { DomainResponderName } from '../../../src/agents/domain-responders';
import { runEAAgent } from '../../../src/agents/ea-agent';
import { runValidatorLoop } from '../../../src/agents/validator-loop';
import { runTestDesignAgent } from '../../../src/agents/test-design-agent';
import { runTaskScheduler } from '../../../src/agents/task-scheduler';
import { advancePipelineStage } from '../../../src/agents/pipeline-stages';
import type { JudgeAdapter } from '../../../src/agents/story-validator-agent';
import type { TestDb } from './db';
import { nowIso } from './db';
import { makeAlwaysPassJudge } from './judge';

export interface DrivePipelineInput {
  /** Stable prompt id (also used as correlationId by default). */
  promptId: string;
  /** Stable correlation id; defaults to promptId. */
  correlationId?: string;
  /** The user's prompt body. */
  promptBody: string;
  /** Optional pre-receivedAt iso string; defaults to now. */
  receivedAt?: string;
  /** Optional hash; defaults to `hash_${promptId}`. */
  hash?: string;
  /** BA collaboration consultants; default ['ea-agent','security-agent','testing-agent','release-agent']. */
  consultants?: DomainResponderName[];
  /** Validator judge override (default: alwaysPass). */
  validatorJudge?: JudgeAdapter;
  /** Validator re-invokeOnFail (default: false — keep loop deterministic). */
  reInvokeOnFail?: boolean;
  /** Validator max attempts (default: VERDICT_THRESHOLDS.maxAttempts). */
  validatorMaxAttempts?: number;
  /**
   * Skip the BA + EA + Validator + Test-Design + Task-Scheduler
   * tail. Used by per-agent regression tests that want to drive
   * only PO + BA, etc.
   */
  stopAfter?:
    | 'ingested'
    | 'scaffolded'
    | 'po_decomposed'
    | 'ba_enriched'
    | 'ea_decomposed'
    | 'validated'
    | 'test_designed'
    | 'bucket_placed'
    | 'ready_for_pickup';
}

export async function drivePipeline(input: DrivePipelineInput, db: TestDb): Promise<void> {
  const correlationId = input.correlationId ?? input.promptId;
  const stopAfter = input.stopAfter ?? 'ready_for_pickup';

  // Insert prompt row (idempotent — caller may have done this).
  const existing = db.select().from(prompts).where(eq(prompts.id, input.promptId)).get();
  if (!existing) {
    db.insert(prompts)
      .values({
        id: input.promptId,
        body: input.promptBody,
        receivedAt: input.receivedAt ?? nowIso(),
        receivedVia: 'api',
        correlationId,
        hash: input.hash ?? `hash_${input.promptId}`,
        status: 'received',
      })
      .run();
  }

  advancePipelineStage({ promptId: input.promptId, stage: 'ingested', correlationId }, db);
  if (stopAfter === 'ingested') return;

  advancePipelineStage({ promptId: input.promptId, stage: 'scaffolded', correlationId }, db);
  if (stopAfter === 'scaffolded') return;

  await runPOAgent(
    {
      promptId: input.promptId,
      promptText: input.promptBody,
      projectId: null,
      correlationId,
    },
    db,
  );
  if (stopAfter === 'po_decomposed') return;

  await runBAAgent(
    {
      promptId: input.promptId,
      correlationId,
      consultants:
        input.consultants ?? [
          'ea-agent',
          'security-agent',
          'testing-agent',
          'release-agent',
        ],
      collabTimeoutMs: 1_500,
    },
    db,
  );
  if (stopAfter === 'ba_enriched') return;

  await runEAAgent({ promptId: input.promptId, correlationId }, db);
  if (stopAfter === 'ea_decomposed') return;

  await runValidatorLoop(
    { promptId: input.promptId, correlationId },
    db,
    {
      reInvokeOnFail: input.reInvokeOnFail ?? false,
      judge: input.validatorJudge ?? makeAlwaysPassJudge(),
      ...(input.validatorMaxAttempts !== undefined && {
        maxAttempts: input.validatorMaxAttempts,
      }),
    },
  );
  if (stopAfter === 'validated') return;

  const tdOut = await runTestDesignAgent(
    { promptId: input.promptId, correlationId },
    db,
  );
  // Mirror the scaffolder's stage advancement (the Test-Design Agent
  // doesn't itself advance the pipeline; production wiring lives in
  // the scaffolder's then-chain).
  advancePipelineStage(
    {
      promptId: input.promptId,
      stage: 'test_designed',
      correlationId,
      metadata: {
        designedStories: tdOut.designedStories,
        totalTestCases: tdOut.totalTestCases,
        storiesSkipped: tdOut.storiesSkipped,
        storiesErrored: tdOut.storiesErrored,
      },
    },
    db,
  );
  if (stopAfter === 'test_designed') return;

  await runTaskScheduler({ promptId: input.promptId, correlationId }, db);
}

/**
 * Convenience: assert every Phase 2 stage was reached in the
 * pipeline-stages table for this prompt. Throws (with the seen +
 * missing sets) on regression so failures diagnose fast.
 */
export function assertAllStagesReached(
  db: TestDb,
  promptId: string,
  stages: readonly string[] = [
    'ingested',
    'scaffolded',
    'po_decomposed',
    'ba_enriched',
    'ea_decomposed',
    'validated',
    'test_designed',
    'bucket_placed',
    'ready_for_pickup',
  ],
): void {
  const rows = db
    .select()
    .from(promptPipelineStages)
    .where(eq(promptPipelineStages.promptId, promptId))
    .all();
  const seen = new Set(rows.map((r) => r.stage));
  const missing = stages.filter((s) => !seen.has(s));
  if (missing.length > 0) {
    throw new Error(
      `pipeline regression: stages missing for ${promptId}: ${missing.join(', ')} (saw: ${[...seen].sort().join(', ')})`,
    );
  }
}

import { promptPipelineStages } from '../../../src/db/schema';
