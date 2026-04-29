/**
 * Pipeline-stage advancement helper.
 *
 * Phase 1 + Phase A advance every prompt through this canonical sequence:
 *
 *   ingested → scaffolded → po_decomposed → ea_classified → ba_enriched
 *   → validated → test_designed → bucket_placed → ready_for_pickup
 *
 * Stage owners:
 *   - ingested, scaffolded         — scaffolder agent (entry point)
 *   - po_decomposed                — PO agent
 *   - ea_classified                — EA agent (BUCKET-003)
 *   - ba_enriched                  — BA agent (cross-agent collab round)
 *   - validated                    — Story Validator agent (VAL-### track)
 *   - test_designed                — Testing agent (TEST-### track)
 *   - bucket_placed,
 *     ready_for_pickup             — Task Manager (BUCKET-### track)
 *
 * Each transition is recorded in `prompt_pipeline_stages` (one row per
 * advancement, with epoch-ms `enteredAt`) and reflected on
 * `prompts.status` so consumers (the dashboard, the E2E test) can poll a
 * single field. A `pipeline.stage.advanced` event is emitted alongside
 * each transition so subscribers can track progression in real time.
 */

import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import { eventBus } from '../events/bus-adapter';
import type { Db } from '../db/connection';
import { promptPipelineStages, prompts } from '../db/schema';

export const PIPELINE_STAGE_ORDER = [
  'received',
  'ingested',
  'scaffolded',
  'po_decomposed',
  // BUCKET-003: EA classifies tech / quality / risk / effort between PO and BA.
  'ea_classified',
  'ba_enriched',
  // VAL-### track: Story Validator gate. Story enters here once BA enrichment
  // completes. Pass → advances to test_designed. Fail → re-invokes BA with
  // feedback (capped at VERDICT_THRESHOLDS.maxAttempts attempts).
  'validated',
  // TEST-### track: Testing Agent generates concrete test cases from the
  // validated ticket. Stage owned by the testing-agent track; declared here
  // so the order is canonical and the Validator can advance to it.
  'test_designed',
  'bucket_placed',
  'ready_for_pickup',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGE_ORDER)[number];

/**
 * Canonical stage names exposed as named constants so call-sites avoid
 * string-typo bugs (a typo to `'validatd'` in the validator agent would
 * silently mis-record a stage). Validator-emitting code should import
 * `STAGE_VALIDATED` rather than the string literal.
 */
export const STAGE_VALIDATED = 'validated' satisfies PipelineStage;
export const STAGE_TEST_DESIGNED = 'test_designed' satisfies PipelineStage;
export const STAGE_BA_ENRICHED = 'ba_enriched' satisfies PipelineStage;
export const STAGE_BUCKET_PLACED = 'bucket_placed' satisfies PipelineStage;
export const STAGE_READY_FOR_PICKUP = 'ready_for_pickup' satisfies PipelineStage;

/**
 * Returns the index of `stage` in PIPELINE_STAGE_ORDER. Useful for sentinel
 * checks like "this prompt has already passed BA" or "Validator must not
 * advance a prompt that's still pre-BA".
 */
export function stageIndex(stage: PipelineStage): number {
  return (PIPELINE_STAGE_ORDER as readonly string[]).indexOf(stage);
}

export interface AdvanceStageInput {
  promptId: string;
  stage: PipelineStage;
  correlationId: string;
  entityKind?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Insert a pipeline-stage row, mirror the stage onto `prompts.status`, and
 * fire `pipeline.stage.advanced`. Idempotent on the row insert (uses unique
 * id), but a stage may legitimately re-advance if a prompt re-runs the
 * pipeline; in that case a new row is appended.
 */
export function advancePipelineStage(input: AdvanceStageInput, db: Db): void {
  const now = Date.now();

  // Compute durationMs from previous stage row (if any) — observability nicety.
  const previous = db
    .select()
    .from(promptPipelineStages)
    .where(eq(promptPipelineStages.promptId, input.promptId))
    .orderBy(desc(promptPipelineStages.enteredAt))
    .limit(1)
    .get();
  const durationMs = previous ? now - previous.enteredAt : undefined;

  // Mark the previous stage row's durationMs once we know it.
  if (previous && previous.durationMs == null) {
    db.update(promptPipelineStages)
      .set({ durationMs })
      .where(eq(promptPipelineStages.id, previous.id))
      .run();
  }

  db.insert(promptPipelineStages)
    .values({
      id: `pps_${nanoid(10)}`,
      promptId: input.promptId,
      stage: input.stage,
      entityKind: input.entityKind ?? 'prompt',
      entityId: input.entityId ?? input.promptId,
      enteredAt: now,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    })
    .run();

  // Mirror onto prompts.status so a single-field poll is enough for E2E +
  // dashboards. We don't enforce monotonicity here — the pipeline itself
  // is responsible for not regressing.
  db.update(prompts)
    .set({ status: input.stage })
    .where(eq(prompts.id, input.promptId))
    .run();

  eventBus.publish({
    type: 'pipeline.stage.advanced',
    actor: 'system',
    correlation_id: input.correlationId,
    entity_type: 'prompt',
    entity_id: input.promptId,
    payload: {
      promptId: input.promptId,
      stage: input.stage,
      entityKind: input.entityKind ?? 'prompt',
      entityId: input.entityId ?? input.promptId,
      durationFromStartMs: durationMs,
    },
  });

  // DASH-104: emit canonical decompose lifecycle events at the relevant
  // stage transitions. `pipeline.decompose_started` fires when the prompt
  // enters the scaffolded stage (decomposer is about to run); the matching
  // `pipeline.decompose_completed` fires when it reaches po_decomposed.
  // Subscribers can pair the two by `correlation_id` (= prompt id).
  if (input.stage === 'scaffolded') {
    eventBus.publish({
      type: 'pipeline.decompose_started',
      actor: 'system',
      correlation_id: input.correlationId,
      entity_type: 'prompt',
      entity_id: input.promptId,
      payload: {
        promptId: input.promptId,
      },
    });
  } else if (input.stage === 'po_decomposed') {
    eventBus.publish({
      type: 'pipeline.decompose_completed',
      actor: 'system',
      correlation_id: input.correlationId,
      entity_type: 'prompt',
      entity_id: input.promptId,
      payload: {
        promptId: input.promptId,
        durationMs: durationMs ?? undefined,
      },
    });
  }
}
