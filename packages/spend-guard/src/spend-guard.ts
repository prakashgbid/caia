/**
 * SpendGuard — checks per-task / per-project / global-day / global-week / global-month
 * caps before every Anthropic API call, records every spend,
 * and pauses the orchestrator when a cap is breached.
 *
 * Reference: caia/docs/spend-guard.md, v2 §6.
 *
 * No-API-key constraint (Prakash 2026-04-30,
 * `feedback_no_api_key_billing.md`): production callers MUST construct
 * the guard with `rejectApiKeyVia: true` so any record() with
 * `via: 'api-key'` throws `ApiKeyViaForbiddenError`. This catches
 * regressions where a code path silently routes a call back through
 * the legacy fetch adapter.
 */

import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CAPS_USD,
  SpendCapSchema,
  SpendRecordSchema,
  type SpendCap,
  type SpendCapScope,
  type SpendRecord,
  type SpendVia,
} from './types.js';
import type { CapStore } from './cap-store.js';

const SECOND = 1000;
const DAY_SEC = 24 * 60 * 60;
const WEEK_SEC = 7 * DAY_SEC;
// Per P5 plan §3 M0: monthly cap = 30 days (2026-05-17).
const MONTH_SEC = 30 * DAY_SEC;
const TASK_PERIOD_SEC = DAY_SEC; // task caps roll daily
const PROJECT_PERIOD_SEC = WEEK_SEC;

export class BudgetExceededError extends Error {
  constructor(
    public readonly cap: SpendCap,
    public readonly attemptedUsd: number,
  ) {
    super(
      `BudgetExceeded: ${cap.scope}='${cap.resourceId}' currentUsd=${cap.currentUsd.toFixed(4)} + attempted=${attemptedUsd.toFixed(4)} > limit=${cap.limitUsd.toFixed(2)}`,
    );
    this.name = 'BudgetExceededError';
  }
}

/**
 * Thrown when a record uses `via: 'api-key'` while the guard is
 * configured with `rejectApiKeyVia: true` (production wiring).
 *
 * Per Prakash 2026-04-30 — the pay-per-token Anthropic API path is
 * forbidden. Production orchestrator wiring sets `rejectApiKeyVia: true`
 * so any regression that reroutes Claude traffic through a fetch-based
 * adapter is caught at record time.
 */
export class ApiKeyViaForbiddenError extends Error {
  constructor(opts: { taskId: string; model: string; agentRole: string }) {
    super(
      `ApiKeyViaForbidden: refusing to record via='api-key' for ` +
        `task='${opts.taskId}' model='${opts.model}' agent='${opts.agentRole}'. ` +
        `The Anthropic pay-per-token path is disabled (Prakash 2026-04-30). ` +
        `Use via='subscription' (claude binary) or via='ollama'.`,
    );
    this.name = 'ApiKeyViaForbiddenError';
  }
}

export interface PauseState {
  paused: boolean;
  reason: string | null;
  /** Wall-clock ms when the pause was set. */
  sinceMsEpoch: number | null;
}

export interface SpendRecordSink {
  /** Append a spend record. Implementations MUST persist immediately. */
  append(record: SpendRecord): Promise<void>;
}

/** In-memory record sink for tests + degraded fallback. */
export class InMemoryRecordSink implements SpendRecordSink {
  records: SpendRecord[] = [];
  async append(record: SpendRecord): Promise<void> {
    this.records.push(SpendRecordSchema.parse(record));
  }
  reset(): void {
    this.records = [];
  }
}

export interface SpendGuardOptions {
  capStore: CapStore;
  recordSink: SpendRecordSink;
  /** Optional override for the v2 §6.4 default caps. */
  caps?: Partial<Record<SpendCapScope, number>>;
  /** Test seam — wall-clock provider. */
  nowMs?: () => number;
  /** Logger called on cap breach + pause / resume. */
  log?: (
    ev:
      | { kind: 'cap-breached'; scope: SpendCapScope; resourceId: string }
      | { kind: 'paused'; reason: string }
      | { kind: 'resumed'; by: string }
      | { kind: 'api-key-rejected'; taskId: string; model: string },
  ) => void;
  /**
   * When true, `record({via:'api-key'})` throws `ApiKeyViaForbiddenError`
   * instead of being persisted. Production orchestrator wiring sets
   * this flag so any regression that calls the pay-per-token path is
   * caught at the cap-record boundary.
   *
   * Defaults to false to preserve historical test/CI behaviour. Flip
   * to `true` in `apps/orchestrator/src/safety/spend-guard-bridge.ts`.
   */
  rejectApiKeyVia?: boolean;
}

export class SpendGuard {
  private readonly capStore: CapStore;
  private readonly recordSink: SpendRecordSink;
  private readonly caps: Record<SpendCapScope, number>;
  private readonly nowMs: () => number;
  private readonly log: SpendGuardOptions['log'];
  private readonly rejectApiKeyVia: boolean;
  private pauseState: PauseState = {
    paused: false,
    reason: null,
    sinceMsEpoch: null,
  };

  constructor(opts: SpendGuardOptions) {
    this.capStore = opts.capStore;
    this.recordSink = opts.recordSink;
    this.caps = { ...DEFAULT_CAPS_USD, ...(opts.caps ?? {}) };
    this.nowMs = opts.nowMs ?? (() => Date.now());
    if (opts.log) this.log = opts.log;
    this.rejectApiKeyVia = opts.rejectApiKeyVia ?? false;
  }

  get pause(): PauseState {
    return { ...this.pauseState };
  }

  /** Resume the pipeline (CLI / dashboard button calls this). */
  resume(by: string): void {
    if (!this.pauseState.paused) return;
    this.pauseState = { paused: false, reason: null, sinceMsEpoch: null };
    this.log?.({ kind: 'resumed', by });
  }

  /**
   * Pre-flight check — call before issuing the API request. Throws
   * `BudgetExceededError` and pauses the orchestrator when any of the
   * applicable caps would be breached. The caller MUST NOT issue the
   * request when this throws.
   */
  async preFlight(opts: {
    taskId: string;
    projectId: string | null;
    estimatedUsd: number;
  }): Promise<void> {
    if (this.pauseState.paused) {
      throw new BudgetExceededError(
        // synthetic cap — caller only needs the message + attempted USD
        {
          scope: 'global-day',
          resourceId: 'paused',
          periodSec: DAY_SEC,
          limitUsd: 0,
          currentUsd: 0,
          lastResetMsEpoch: this.nowMs(),
          lockedUntilMsEpoch: null,
        },
        opts.estimatedUsd,
      );
    }
    const checks: Array<{ scope: SpendCapScope; resourceId: string; periodSec: number }> = [
      { scope: 'task', resourceId: opts.taskId, periodSec: TASK_PERIOD_SEC },
      { scope: 'global-day', resourceId: 'global', periodSec: DAY_SEC },
      { scope: 'global-week', resourceId: 'global', periodSec: WEEK_SEC },
      { scope: 'global-month', resourceId: 'global', periodSec: MONTH_SEC },
    ];
    if (opts.projectId) {
      checks.push({
        scope: 'project',
        resourceId: opts.projectId,
        periodSec: PROJECT_PERIOD_SEC,
      });
    }
    for (const c of checks) {
      const cap = await this.capStore.getOrCreate({
        scope: c.scope,
        resourceId: c.resourceId,
        defaultLimitUsd: this.caps[c.scope],
        defaultPeriodSec: c.periodSec,
        nowMs: this.nowMs(),
      });
      const refreshed = this.maybeReset(cap);
      if (refreshed.currentUsd + opts.estimatedUsd > refreshed.limitUsd) {
        this.log?.({
          kind: 'cap-breached',
          scope: c.scope,
          resourceId: c.resourceId,
        });
        if (c.scope === 'global-day') {
          this.pauseState = {
            paused: true,
            reason: `global-day cap breached at ${refreshed.currentUsd.toFixed(2)} USD; estimated +${opts.estimatedUsd.toFixed(2)} would exceed limit ${refreshed.limitUsd.toFixed(2)}`,
            sinceMsEpoch: this.nowMs(),
          };
          this.log?.({ kind: 'paused', reason: this.pauseState.reason! });
        }
        throw new BudgetExceededError(refreshed, opts.estimatedUsd);
      }
    }
  }

  /** Record an actual spend after the API response is in. */
  async record(opts: {
    taskId: string;
    projectId: string | null;
    agentRole: string;
    model: string;
    via: SpendVia;
    accountId: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): Promise<SpendRecord> {
    if (this.rejectApiKeyVia && opts.via === 'api-key') {
      this.log?.({
        kind: 'api-key-rejected',
        taskId: opts.taskId,
        model: opts.model,
      });
      throw new ApiKeyViaForbiddenError({
        taskId: opts.taskId,
        model: opts.model,
        agentRole: opts.agentRole,
      });
    }
    const ts = this.nowMs();
    const record: SpendRecord = SpendRecordSchema.parse({
      id: randomUUID(),
      taskId: opts.taskId,
      projectId: opts.projectId,
      agentRole: opts.agentRole,
      model: opts.model,
      via: opts.via,
      accountId: opts.accountId,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      costUsd: opts.costUsd,
      tsMsEpoch: ts,
    });
    await this.recordSink.append(record);

    // Increment every applicable cap. Ollama spend doesn't bill (free
    // local) so we skip cap accounting for it.
    if (opts.via === 'ollama') return record;

    const buckets: Array<{ scope: SpendCapScope; resourceId: string; periodSec: number }> = [
      { scope: 'task', resourceId: opts.taskId, periodSec: TASK_PERIOD_SEC },
      { scope: 'global-day', resourceId: 'global', periodSec: DAY_SEC },
      { scope: 'global-week', resourceId: 'global', periodSec: WEEK_SEC },
      { scope: 'global-month', resourceId: 'global', periodSec: MONTH_SEC },
    ];
    if (opts.projectId) {
      buckets.push({
        scope: 'project',
        resourceId: opts.projectId,
        periodSec: PROJECT_PERIOD_SEC,
      });
    }
    for (const b of buckets) {
      const cap = await this.capStore.getOrCreate({
        scope: b.scope,
        resourceId: b.resourceId,
        defaultLimitUsd: this.caps[b.scope],
        defaultPeriodSec: b.periodSec,
        nowMs: ts,
      });
      const next = this.maybeReset(cap);
      const updated = SpendCapSchema.parse({
        ...next,
        currentUsd: Number((next.currentUsd + opts.costUsd).toFixed(6)),
      });
      await this.capStore.put(updated);
    }
    return record;
  }

  /**
   * Returns true when daily spend has crossed `pct` of the daily cap
   * (default 80%). Used by `local-llm-router` to start preferring Ollama.
   */
  async dailySpendPctOver(pct: number): Promise<boolean> {
    const cap = await this.capStore.getOrCreate({
      scope: 'global-day',
      resourceId: 'global',
      defaultLimitUsd: this.caps['global-day'],
      defaultPeriodSec: DAY_SEC,
      nowMs: this.nowMs(),
    });
    const refreshed = this.maybeReset(cap);
    if (refreshed.limitUsd <= 0) return false;
    return refreshed.currentUsd / refreshed.limitUsd >= pct;
  }

  /** Test helper — current pause state without cloning. */
  _peekPause(): PauseState {
    return this.pauseState;
  }

  private maybeReset(cap: SpendCap): SpendCap {
    const elapsedSec = (this.nowMs() - cap.lastResetMsEpoch) / SECOND;
    if (elapsedSec < cap.periodSec) return cap;
    const reset = SpendCapSchema.parse({
      ...cap,
      currentUsd: 0,
      lastResetMsEpoch: this.nowMs(),
      lockedUntilMsEpoch: null,
    });
    return reset;
  }
}
