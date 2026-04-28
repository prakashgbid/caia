/**
 * Phase-1 metrics route (GATE-4-04).
 *
 * Provides a lightweight dashboard counter panel for the live Phase-1
 * pipeline: prompts in flight, prompts decomposed, prompts BA-enriched,
 * bucket placements/min, and average latency per stage.
 *
 * All metrics are derived from existing tables (prompts,
 * prompt_pipeline_stages, task_buckets) so no new event types and no
 * new state are required. Read-only and no side effects.
 *
 * Endpoint:
 *   GET /metrics/phase1?windowMin=15
 *
 * Returns:
 *   {
 *     promptsInFlight: number,
 *     promptsByStatus: { ingested, scaffolded, po_decomposed,
 *                        ba_enriched, bucket_placed, ready_for_pickup,
 *                        failed, ... },
 *     bucketsCreatedLastWindow: number,
 *     bucketPlacementsPerMin: number,
 *     stageLatencyMsAvg: { [stage]: number },
 *     stageLatencyMsP50: { [stage]: number },
 *     windowMinutes: number,
 *   }
 */

import type { Hono } from 'hono';
import { gte, asc } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { prompts, promptPipelineStages, taskBuckets } from '../../db/schema';

// Phase-1 terminal stages — anything else is "in flight".
const TERMINAL_STAGES = new Set(['ready_for_pickup', 'failed']);

// @no-events — read-only metrics
export function registerMetricsPhase1Routes(app: Hono, db: Db): void {
  app.get('/metrics/phase1', (c) => {
    const windowMinutesRaw = c.req.query('windowMin');
    const parsed = windowMinutesRaw == null ? 15 : parseInt(windowMinutesRaw, 10);
    const windowMinutes = Number.isFinite(parsed)
      ? Math.max(1, Math.min(parsed, 60 * 24))
      : 15;
    const windowMs = windowMinutes * 60_000;
    const cutoffMs = Date.now() - windowMs;

    // Prompts: count by status, total in-flight.
    const allPrompts = db.select({ status: prompts.status }).from(prompts).all();
    const promptsByStatus: Record<string, number> = {};
    for (const p of allPrompts) {
      const k = p.status ?? 'unknown';
      promptsByStatus[k] = (promptsByStatus[k] ?? 0) + 1;
    }
    const promptsInFlight = Object.entries(promptsByStatus)
      .filter(([k]) => !TERMINAL_STAGES.has(k))
      .reduce((acc, [, v]) => acc + v, 0);

    // Buckets created within the window.
    const bucketsRecent = db
      .select({ id: taskBuckets.id, createdAt: taskBuckets.createdAt })
      .from(taskBuckets)
      .where(gte(taskBuckets.createdAt, cutoffMs))
      .all();
    const bucketsCreatedLastWindow = bucketsRecent.length;
    const bucketPlacementsPerMin = bucketsCreatedLastWindow / windowMinutes;

    // Pipeline stage latencies — pull rows in the window with a
    // back-filled durationMs and bucket by stage. The bucket-placer
    // back-fills the previous stage's durationMs when the next stage
    // advances, so durationMs always belongs to the stage it sits on
    // (i.e. how long the prompt spent IN that stage before advancing).
    const stageRows = db
      .select({ stage: promptPipelineStages.stage, durationMs: promptPipelineStages.durationMs, enteredAt: promptPipelineStages.enteredAt })
      .from(promptPipelineStages)
      .where(gte(promptPipelineStages.enteredAt, cutoffMs))
      .orderBy(asc(promptPipelineStages.enteredAt))
      .all();
    const stageDurations = new Map<string, number[]>();
    for (const row of stageRows) {
      if (row.durationMs == null) continue;
      const arr = stageDurations.get(row.stage) ?? [];
      arr.push(row.durationMs);
      stageDurations.set(row.stage, arr);
    }
    const stageLatencyMsAvg: Record<string, number> = {};
    const stageLatencyMsP50: Record<string, number> = {};
    for (const [stage, ds] of stageDurations.entries()) {
      const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
      const sorted = [...ds].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const p50 = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
      stageLatencyMsAvg[stage] = Math.round(avg);
      stageLatencyMsP50[stage] = Math.round(p50);
    }

    return c.json({
      windowMinutes,
      promptsInFlight,
      promptsByStatus,
      bucketsCreatedLastWindow,
      bucketPlacementsPerMin: Math.round(bucketPlacementsPerMin * 100) / 100,
      stageLatencyMsAvg,
      stageLatencyMsP50,
    });
  });
}
