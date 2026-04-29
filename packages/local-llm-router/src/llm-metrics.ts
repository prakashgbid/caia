// In-memory LLM call tracker (LAI-006).
//
// Every dispatch through the router records here so a dashboard can show
// the share of work that's served by local Ollama vs Claude, plus an
// estimate of the dollars saved against the all-Claude baseline.
//
// This module is exported from @chiefaia/local-llm-router but does NOT
// auto-record on its own — the call site (the orchestrator's /llm/route
// handler in this repo) records each outcome explicitly. Keeping it
// passive lets tests construct their own tracker without polluting the
// module-level singleton.

export type LlmMetricsProvider = 'local' | 'claude';

export interface LlmCallRecord {
  taskType: string;
  provider: LlmMetricsProvider;
  model: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  /** Per-call USD estimate (computed from the routing rule's claude cost). */
  estimatedCostUsd: number;
  /** Per-call USD estimate if this had been routed to Claude (the savings). */
  baselineCostUsd: number;
  /** Cache hit kind, if the call was served by @chiefaia/llm-cache. */
  cacheHitKind?: 'exact' | 'semantic' | undefined;
  /** Epoch ms when the call was recorded. */
  timestamp: number;
}

interface PerTaskBucket {
  calls: number;
  localCalls: number;
  claudeCalls: number;
  cacheHits: number;
  totalDurationMs: number;
  estimatedCostUsd: number;
  baselineCostUsd: number;
}

const RING_BUFFER_SIZE = 1_000;

export class LlmMetricsTracker {
  private readonly buckets = new Map<string, PerTaskBucket>();
  private readonly recent: LlmCallRecord[] = [];
  private totalCalls = 0;
  private localCalls = 0;
  private claudeCalls = 0;
  private cacheHits = 0;
  private totalDurationMs = 0;
  private totalCostUsd = 0;
  private totalBaselineUsd = 0;

  record(call: LlmCallRecord): void {
    this.totalCalls++;
    this.totalDurationMs += call.durationMs;
    this.totalCostUsd += call.estimatedCostUsd;
    this.totalBaselineUsd += call.baselineCostUsd;
    if (call.provider === 'local') this.localCalls++;
    else this.claudeCalls++;
    if (call.cacheHitKind) this.cacheHits++;

    let bucket = this.buckets.get(call.taskType);
    if (!bucket) {
      bucket = freshBucket();
      this.buckets.set(call.taskType, bucket);
    }
    bucket.calls++;
    bucket.totalDurationMs += call.durationMs;
    bucket.estimatedCostUsd += call.estimatedCostUsd;
    bucket.baselineCostUsd += call.baselineCostUsd;
    if (call.provider === 'local') bucket.localCalls++;
    else bucket.claudeCalls++;
    if (call.cacheHitKind) bucket.cacheHits++;

    this.recent.push(call);
    if (this.recent.length > RING_BUFFER_SIZE) {
      this.recent.shift();
    }
  }

  snapshot(): LlmMetricsSnapshot {
    const tasks: LlmMetricsSnapshotTask[] = [];
    for (const [taskType, bucket] of this.buckets.entries()) {
      tasks.push({
        taskType,
        calls: bucket.calls,
        localCalls: bucket.localCalls,
        claudeCalls: bucket.claudeCalls,
        cacheHits: bucket.cacheHits,
        avgDurationMs:
          bucket.calls > 0 ? bucket.totalDurationMs / bucket.calls : 0,
        estimatedCostUsd: round4(bucket.estimatedCostUsd),
        baselineCostUsd: round4(bucket.baselineCostUsd),
        savedUsd: round4(bucket.baselineCostUsd - bucket.estimatedCostUsd),
        localShare:
          bucket.calls > 0 ? bucket.localCalls / bucket.calls : 0,
      });
    }
    tasks.sort((a, b) => b.calls - a.calls);

    const localShare =
      this.totalCalls > 0 ? this.localCalls / this.totalCalls : 0;
    const cacheHitRate =
      this.totalCalls > 0 ? this.cacheHits / this.totalCalls : 0;

    return {
      totalCalls: this.totalCalls,
      localCalls: this.localCalls,
      claudeCalls: this.claudeCalls,
      cacheHits: this.cacheHits,
      cacheHitRate,
      localShare,
      avgDurationMs:
        this.totalCalls > 0 ? this.totalDurationMs / this.totalCalls : 0,
      estimatedCostUsd: round4(this.totalCostUsd),
      baselineCostUsd: round4(this.totalBaselineUsd),
      savedUsd: round4(this.totalBaselineUsd - this.totalCostUsd),
      perTask: tasks,
    };
  }

  reset(): void {
    this.buckets.clear();
    this.recent.length = 0;
    this.totalCalls = 0;
    this.localCalls = 0;
    this.claudeCalls = 0;
    this.cacheHits = 0;
    this.totalDurationMs = 0;
    this.totalCostUsd = 0;
    this.totalBaselineUsd = 0;
  }
}

export interface LlmMetricsSnapshotTask {
  taskType: string;
  calls: number;
  localCalls: number;
  claudeCalls: number;
  cacheHits: number;
  avgDurationMs: number;
  estimatedCostUsd: number;
  baselineCostUsd: number;
  savedUsd: number;
  localShare: number;
}

export interface LlmMetricsSnapshot {
  totalCalls: number;
  localCalls: number;
  claudeCalls: number;
  cacheHits: number;
  cacheHitRate: number;
  localShare: number;
  avgDurationMs: number;
  estimatedCostUsd: number;
  baselineCostUsd: number;
  savedUsd: number;
  perTask: LlmMetricsSnapshotTask[];
}

function freshBucket(): PerTaskBucket {
  return {
    calls: 0,
    localCalls: 0,
    claudeCalls: 0,
    cacheHits: 0,
    totalDurationMs: 0,
    estimatedCostUsd: 0,
    baselineCostUsd: 0,
  };
}

// Round to 4 decimals (tenths of a cent). Per-call savings are typically
// $0.0001-0.003, so 2-decimal rounding crushed the signal. The dashboard
// can format down further for display.
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Parse the dollar amount out of a routing-rule cost string like "$0.40"
 * (per 1000 calls) and return the per-call dollars-per-call.
 */
export function perCallCostFromRuleString(rawDollars: string): number {
  // Routing rules express cost per 1000 calls. Strip "$" and divide.
  const numeric = parseFloat(rawDollars.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric)) return 0;
  return numeric / 1000;
}

/** Module-level singleton tracker. Tests can construct their own. */
export const llmMetrics = new LlmMetricsTracker();
