/**
 * PipelineCostTracker — HARDEN-002 (Production hardening).
 *
 * Per-pipeline-run cost accounting joined to the prompt's correlation_id.
 * The existing in-memory llmMetrics tracker (LAI-006) gives a global
 * aggregate, but operators need to know which pipeline-run is racking
 * up dollars and which agent inside that run is responsible. This
 * module persists every call to the `pipeline_run_costs` table and
 * fires `pipeline.cost.alert` once per run when the cumulative spend
 * crosses an env-configurable ceiling.
 *
 * Schema: pipeline_run_costs (migration 0035)
 *   - correlation_id     primary key
 *   - total_calls / local_calls / claude_calls  rolling counts
 *   - total_cost_usd / baseline_cost_usd        rolling dollars (4dp)
 *   - per_agent_breakdown_json                  { [agent]: { calls, costUsd, baselineUsd } }
 *   - started_at / last_updated_at              epoch ms
 *   - alert_triggered_at                        first time the threshold tripped
 *
 * The tracker is plugged into the POST /llm/route handler — every call
 * with a correlationId + agent in the body lands here.
 *
 * @owner observability (Phase 2 / production hardening)
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { pipelineRunCosts } from '../db/schema';
import { eventBus } from '../events/bus-adapter';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CostCallInput {
  correlationId: string;
  /** The agent or pipeline stage that issued the LLM call. */
  agent: string;
  /** 'local' (Ollama) or 'claude'. */
  provider: 'local' | 'claude';
  /** Cost actually incurred (0 for local). */
  estimatedCostUsd: number;
  /** What this call would have cost if routed to Claude (the savings). */
  baselineCostUsd: number;
}

export interface CostSnapshot {
  correlationId: string;
  totalCalls: number;
  localCalls: number;
  claudeCalls: number;
  totalCostUsd: number;
  baselineCostUsd: number;
  savedUsd: number;
  perAgent: Record<string, { calls: number; costUsd: number; baselineUsd: number }>;
  startedAt: number;
  lastUpdatedAt: number;
  alertTriggeredAt: number | null;
}

export interface TrackerOptions {
  /** Threshold in USD. Default $5. Single-run ceiling. */
  alertThresholdUsd?: number;
  /** Skip event emission (unit tests). */
  silent?: boolean;
  /** Override Date.now (tests). */
  now?: () => number;
}

// ─── Class ──────────────────────────────────────────────────────────────────

export class PipelineCostTracker {
  private readonly db: Db;
  private readonly threshold: number;
  private readonly silent: boolean;
  private readonly now: () => number;

  constructor(db: Db, opts: TrackerOptions = {}) {
    this.db = db;
    this.threshold = opts.alertThresholdUsd ?? 5;
    this.silent = opts.silent ?? false;
    this.now = opts.now ?? Date.now;
    if (this.threshold <= 0) {
      throw new Error(
        `PipelineCostTracker: alertThresholdUsd must be > 0 (got ${this.threshold})`,
      );
    }
  }

  /**
   * Records a single LLM call into the per-run row. Idempotent on the
   * insert (UPSERT-style: ROW MISSING -> create with started_at; row
   * present -> bump counters). Returns the post-update snapshot so
   * callers can immediately surface dashboard updates without an extra
   * read.
   */
  recordCall(input: CostCallInput): CostSnapshot {
    const ts = this.now();

    const snapshot = this.db.transaction((trx) => {
      const existing = trx
        .select()
        .from(pipelineRunCosts)
        .where(eq(pipelineRunCosts.correlationId, input.correlationId))
        .get();

      const breakdown = existing
        ? safeJsonObject(existing.perAgentBreakdownJson)
        : {};

      const agentEntry = (breakdown[input.agent] as
        | { calls?: number; costUsd?: number; baselineUsd?: number }
        | undefined) ?? { calls: 0, costUsd: 0, baselineUsd: 0 };
      breakdown[input.agent] = {
        calls: (agentEntry.calls ?? 0) + 1,
        costUsd: round4((agentEntry.costUsd ?? 0) + input.estimatedCostUsd),
        baselineUsd: round4((agentEntry.baselineUsd ?? 0) + input.baselineCostUsd),
      };

      const totalCalls = (existing?.totalCalls ?? 0) + 1;
      const localCalls = (existing?.localCalls ?? 0) + (input.provider === 'local' ? 1 : 0);
      const claudeCalls = (existing?.claudeCalls ?? 0) + (input.provider === 'claude' ? 1 : 0);
      const totalCostUsd = round4((existing?.totalCostUsd ?? 0) + input.estimatedCostUsd);
      const baselineCostUsd = round4((existing?.baselineCostUsd ?? 0) + input.baselineCostUsd);
      const startedAt = existing?.startedAt ?? ts;
      const alertTriggeredAt = existing?.alertTriggeredAt ?? null;

      if (existing) {
        trx
          .update(pipelineRunCosts)
          .set({
            totalCalls,
            localCalls,
            claudeCalls,
            totalCostUsd,
            baselineCostUsd,
            perAgentBreakdownJson: JSON.stringify(breakdown),
            lastUpdatedAt: ts,
          })
          .where(eq(pipelineRunCosts.correlationId, input.correlationId))
          .run();
      } else {
        trx
          .insert(pipelineRunCosts)
          .values({
            correlationId: input.correlationId,
            totalCalls,
            localCalls,
            claudeCalls,
            totalCostUsd,
            baselineCostUsd,
            perAgentBreakdownJson: JSON.stringify(breakdown),
            startedAt,
            lastUpdatedAt: ts,
            alertTriggeredAt: null,
          })
          .run();
      }

      return {
        totalCalls,
        localCalls,
        claudeCalls,
        totalCostUsd,
        baselineCostUsd,
        breakdown,
        startedAt,
        alertTriggeredAt,
      };
    });

    // Threshold trip — fire once per run.
    let alertTriggeredAt = snapshot.alertTriggeredAt;
    if (alertTriggeredAt === null && snapshot.totalCostUsd >= this.threshold) {
      this.db
        .update(pipelineRunCosts)
        .set({ alertTriggeredAt: ts })
        .where(eq(pipelineRunCosts.correlationId, input.correlationId))
        .run();
      alertTriggeredAt = ts;
      this.emit({
        correlationId: input.correlationId,
        totalCostUsd: snapshot.totalCostUsd,
        thresholdUsd: this.threshold,
        ts,
      });
    }

    return {
      correlationId: input.correlationId,
      totalCalls: snapshot.totalCalls,
      localCalls: snapshot.localCalls,
      claudeCalls: snapshot.claudeCalls,
      totalCostUsd: snapshot.totalCostUsd,
      baselineCostUsd: snapshot.baselineCostUsd,
      savedUsd: round4(snapshot.baselineCostUsd - snapshot.totalCostUsd),
      perAgent: snapshot.breakdown as CostSnapshot['perAgent'],
      startedAt: snapshot.startedAt,
      lastUpdatedAt: ts,
      alertTriggeredAt,
    };
  }

  /** Returns the snapshot for a run (or null). */
  get(correlationId: string): CostSnapshot | null {
    const row = this.db
      .select()
      .from(pipelineRunCosts)
      .where(eq(pipelineRunCosts.correlationId, correlationId))
      .get();
    if (!row) return null;
    const breakdown = safeJsonObject(row.perAgentBreakdownJson);
    return {
      correlationId: row.correlationId,
      totalCalls: row.totalCalls,
      localCalls: row.localCalls,
      claudeCalls: row.claudeCalls,
      totalCostUsd: row.totalCostUsd,
      baselineCostUsd: row.baselineCostUsd,
      savedUsd: round4(row.baselineCostUsd - row.totalCostUsd),
      perAgent: breakdown as CostSnapshot['perAgent'],
      startedAt: row.startedAt,
      lastUpdatedAt: row.lastUpdatedAt,
      alertTriggeredAt: row.alertTriggeredAt ?? null,
    };
  }

  /** Returns the N most-recent runs sorted by lastUpdatedAt desc. */
  recent(limit = 25): CostSnapshot[] {
    const rows = this.db
      .select()
      .from(pipelineRunCosts)
      .all()
      .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
      .slice(0, limit);
    return rows.map((row) => ({
      correlationId: row.correlationId,
      totalCalls: row.totalCalls,
      localCalls: row.localCalls,
      claudeCalls: row.claudeCalls,
      totalCostUsd: row.totalCostUsd,
      baselineCostUsd: row.baselineCostUsd,
      savedUsd: round4(row.baselineCostUsd - row.totalCostUsd),
      perAgent: safeJsonObject(row.perAgentBreakdownJson) as CostSnapshot['perAgent'],
      startedAt: row.startedAt,
      lastUpdatedAt: row.lastUpdatedAt,
      alertTriggeredAt: row.alertTriggeredAt ?? null,
    }));
  }

  private emit(payload: {
    correlationId: string;
    totalCostUsd: number;
    thresholdUsd: number;
    ts: number;
  }): void {
    if (this.silent) return;
    eventBus.publish({
      type: 'pipeline.cost.alert' as never,
      actor: 'system',
      entity_type: 'pipeline_run',
      entity_id: payload.correlationId,
      severity: 'warning',
      correlation_id: payload.correlationId,
      payload,
    });
  }
}

function safeJsonObject(s: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _singleton: PipelineCostTracker | null = null;

export function getPipelineCostTracker(db?: Db, opts: TrackerOptions = {}): PipelineCostTracker {
  if (_singleton) return _singleton;
  if (!db) throw new Error('PipelineCostTracker singleton not yet initialised — pass db on first call');
  _singleton = new PipelineCostTracker(db, opts);
  return _singleton;
}

/** Test-only seam: reset the singleton between cases. */
export function __resetPipelineCostTracker(): void {
  _singleton = null;
}
