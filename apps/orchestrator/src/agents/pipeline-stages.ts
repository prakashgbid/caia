/**
 * Pipeline-stage advancement helper.
 *
 * Phase 1 advances every prompt through this canonical sequence:
 *
 *   ingested → scaffolded → po_decomposed → ba_enriched → bucket_placed
 *   → ready_for_pickup
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
  'ba_enriched',
  'bucket_placed',
  'ready_for_pickup',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGE_ORDER)[number];

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
}
