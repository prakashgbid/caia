/**
 * SAFETY-004 — orchestrator-side spend-guard bridge.
 *
 * Wires `@chiefaia/spend-guard` to:
 *   - the SQLite cap store (DB-backed CapStore implementation),
 *   - the orchestrator pump (pause runs on BudgetExceededError),
 *   - the `/llm/route` API (preFlight + record on every Claude call),
 *   - the `pnpm caia spend resume` CLI command,
 *   - the dashboard widget data source (GET /spend/today).
 *
 * Defaults per v2 §6.4:
 *   - global-day:  $25
 *   - global-week: $100
 *   - project:     $30 (per project, weekly)
 *   - task:        $1.50 (per task, daily)
 *
 * Account-pool default = 2 (multi) per Prakash 2026-04-29 update; serial
 * fallback when both accounts are rate-limited.
 *
 * No-API-key constraint (Prakash 2026-04-30 — see
 * `feedback_no_api_key_billing.md`): production wiring constructs the
 * SpendGuard with `rejectApiKeyVia: true` so any record() that uses
 * `via: 'api-key'` throws `ApiKeyViaForbiddenError`. Catches regressions
 * where a code path silently routes a Claude call through the legacy
 * fetch-based adapter instead of the new `claude` binary spawn.
 *
 * Reference: caia/docs/spend-guard.md, v2 §6.
 */

import {
  SpendGuard,
  BudgetExceededError,
  InMemoryCapStore,
  InMemoryRecordSink,
  AccountPool,
  computeCostUsd,
  estimateRequestCostUsd,
  ApiKeyViaForbiddenError,
  type CapStore,
  type SpendRecordSink,
  type SpendCap,
  type SpendCapScope,
  type SpendRecord,
  type SpendVia,
  type AccountState,
  type AccountPoolMode,
  type PauseState,
} from '@chiefaia/spend-guard';

export type { BudgetExceededError, PauseState };

export interface SpendGuardBridgeOptions {
  capStore?: CapStore;
  recordSink?: SpendRecordSink;
  /** Optional override for v2 §6.4 default caps. */
  caps?: Partial<Record<SpendCapScope, number>>;
  /** Test seam — wall-clock provider. */
  nowMs?: () => number;
  /** Optional logger; default stderr. */
  log?: (msg: string) => void;
  /**
   * No-API-key constraint (Prakash 2026-04-30,
   * `feedback_no_api_key_billing.md`). Defaults to TRUE — production
   * orchestrator wiring rejects any record() with `via: 'api-key'`.
   * Tests that intentionally exercise the legacy fetch path can pass
   * `false` to opt out (none should in production code).
   */
  rejectApiKeyVia?: boolean;
}

export interface SpendGuardBridge {
  guard: SpendGuard;
  pool: AccountPool | null;
  preFlight: (opts: {
    taskId: string;
    projectId: string | null;
    estimatedUsd: number;
  }) => Promise<void>;
  record: (opts: {
    taskId: string;
    projectId: string | null;
    agentRole: string;
    model: string;
    via: SpendVia;
    accountId: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }) => Promise<SpendRecord>;
  pauseState: () => PauseState;
  resume: (by: string) => void;
  /** True when daily spend has crossed `pct` of the daily cap (default 0.8). */
  isOverPct: (pct?: number) => Promise<boolean>;
}

/**
 * Build a SpendGuardBridge. Uses InMemoryCapStore + InMemoryRecordSink
 * by default — orchestrator wiring overrides with SQLite-backed
 * implementations.
 */
export function buildSpendGuardBridge(opts: SpendGuardBridgeOptions = {}): SpendGuardBridge {
  const log = opts.log ?? ((m: string) => process.stderr.write(`[spend-guard] ${m}\n`));
  const capStore = opts.capStore ?? new InMemoryCapStore();
  const recordSink = opts.recordSink ?? new InMemoryRecordSink();
  const guard = new SpendGuard({
    capStore,
    recordSink,
    ...(opts.caps ? { caps: opts.caps } : {}),
    ...(opts.nowMs ? { nowMs: opts.nowMs } : {}),
    rejectApiKeyVia: opts.rejectApiKeyVia ?? true,
    log: (ev) => {
      if (ev.kind === 'paused') log(`PAUSED: ${ev.reason}`);
      else if (ev.kind === 'resumed') log(`RESUMED by=${ev.by}`);
      else if (ev.kind === 'cap-breached') log(`cap breach: ${ev.scope}=${ev.resourceId}`);
      else if (ev.kind === 'api-key-rejected')
        log(`api-key REJECTED for task=${ev.taskId} model=${ev.model} (no-API-key rule)`);
    },
  });

  return {
    guard,
    pool: null, // wired separately by buildAccountPoolBridge below
    preFlight: (a) => guard.preFlight(a),
    record: (a) => guard.record(a),
    pauseState: () => guard.pause,
    resume: (by) => guard.resume(by),
    isOverPct: (pct = 0.8) => guard.dailySpendPctOver(pct),
  };
}

/** Build the account pool — 2 accounts, multi mode, with serial fallback. */
export function buildAccountPoolBridge(opts: {
  accounts: readonly AccountState[];
  mode?: AccountPoolMode;
  nowMs?: () => number;
} = { accounts: [] }): AccountPool {
  return new AccountPool({
    accounts: opts.accounts,
    mode: opts.mode ?? 'multi',
    ...(opts.nowMs ? { nowMs: opts.nowMs } : {}),
  });
}

// Re-export commonly used types so callers don't have to import the
// underlying package directly.
export {
  SpendGuard,
  BudgetExceededError as SpendBudgetExceededError,
  ApiKeyViaForbiddenError,
  InMemoryCapStore,
  InMemoryRecordSink,
  AccountPool,
  computeCostUsd,
  estimateRequestCostUsd,
};
export type {
  CapStore,
  SpendRecordSink,
  SpendCap,
  SpendCapScope,
  SpendRecord,
  SpendVia,
  AccountState,
  AccountPoolMode,
};
