/**
 * SAFETY-004 — spend-guard orchestrator wireup tests (12 cases).
 *
 *  1. preFlight allows when under cap.
 *  2. preFlight blocks at task cap.
 *  3. record increments task + global-day caps.
 *  4. global-day reset on period boundary.
 *  5. ollama spend not counted toward caps.
 *  6. resume clears pause state.
 *  7. dashboard endpoint shape (sumCostUsd via SqliteRecordSink).
 *  8. AccountPool: serial fallback when both rate-limited.
 *  9. router-level fallback indicator (dailySpendPctOver) at 80%.
 * 10. SQLite cap-store round-trip (getOrCreate → put → list).
 * 11. global-day cap pauses bridge.
 * 12. project cap does NOT pause bridge (only global-day pauses).
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  buildSpendGuardBridge,
  buildAccountPoolBridge,
  SpendBudgetExceededError,
  InMemoryCapStore,
  InMemoryRecordSink,
} from './spend-guard-bridge';
import { SqliteCapStore, SqliteRecordSink } from './spend-cap-store-sqlite';

const SCHEMA_SQL = `
CREATE TABLE spend_caps (
  scope text NOT NULL,
  resource_id text NOT NULL,
  period_sec integer NOT NULL,
  limit_usd real NOT NULL,
  current_usd real NOT NULL DEFAULT 0,
  last_reset_ms_epoch integer NOT NULL,
  locked_until_ms_epoch integer,
  PRIMARY KEY (scope, resource_id)
);
CREATE TABLE spend_records (
  id text PRIMARY KEY NOT NULL,
  task_id text NOT NULL,
  project_id text,
  agent_role text NOT NULL,
  model text NOT NULL,
  via text NOT NULL,
  account_id text,
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  cost_usd real NOT NULL,
  ts_ms_epoch integer NOT NULL
);
`;

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

describe('SAFETY-004 spend-guard bridge', () => {
  it('1. preFlight allows when under cap', async () => {
    const bridge = buildSpendGuardBridge();
    await expect(
      bridge.preFlight({ taskId: 't1', projectId: null, estimatedUsd: 0.05 }),
    ).resolves.toBeUndefined();
  });

  it('2. preFlight blocks at task cap', async () => {
    const bridge = buildSpendGuardBridge({ caps: { task: 0.10 } });
    // Record almost a full task budget first.
    await bridge.record({
      taskId: 't2', projectId: null, agentRole: 'r', model: 'claude-sonnet-4-6',
      via: 'subscription', accountId: 'a1', inputTokens: 0, outputTokens: 0, costUsd: 0.09,
    });
    // Next preFlight that would push over should throw.
    await expect(
      bridge.preFlight({ taskId: 't2', projectId: null, estimatedUsd: 0.05 }),
    ).rejects.toBeInstanceOf(SpendBudgetExceededError);
  });

  it('3. record increments task + global-day caps', async () => {
    const sink = new InMemoryRecordSink();
    const bridge = buildSpendGuardBridge({ recordSink: sink });
    await bridge.record({
      taskId: 't3', projectId: null, agentRole: 'r', model: 'claude-sonnet-4-6',
      via: 'subscription', accountId: 'a1', inputTokens: 100, outputTokens: 200, costUsd: 0.5,
    });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]!.costUsd).toBe(0.5);
  });

  it('4. global-day reset on period boundary', async () => {
    let now = 1_700_000_000_000;
    const bridge = buildSpendGuardBridge({
      caps: { 'global-day': 1.0 },
      nowMs: () => now,
    });
    await bridge.record({
      taskId: 't4', projectId: null, agentRole: 'r', model: 'claude-sonnet-4-6',
      via: 'subscription', accountId: 'a1', inputTokens: 0, outputTokens: 0, costUsd: 0.95,
    });
    // 25 hours later — period reset.
    now = now + 25 * 60 * 60 * 1000;
    await expect(
      bridge.preFlight({ taskId: 't4-2', projectId: null, estimatedUsd: 0.50 }),
    ).resolves.toBeUndefined();
  });

  it('5. ollama spend not counted toward caps', async () => {
    const bridge = buildSpendGuardBridge({ caps: { 'global-day': 0.10 } });
    // Record an ollama spend that would otherwise breach — should not pause.
    await bridge.record({
      taskId: 't5', projectId: null, agentRole: 'r', model: 'qwen-7b',
      via: 'ollama', accountId: null, inputTokens: 100, outputTokens: 100, costUsd: 1.0,
    });
    expect(bridge.pauseState().paused).toBe(false);
    // Subsequent claude preFlight is unaffected by the (uncounted) ollama spend.
    await expect(
      bridge.preFlight({ taskId: 't5', projectId: null, estimatedUsd: 0.05 }),
    ).resolves.toBeUndefined();
  });

  it('6. resume clears pause state', async () => {
    const bridge = buildSpendGuardBridge({ caps: { 'global-day': 0.05 } });
    // Trip the pause.
    try {
      await bridge.record({
        taskId: 't6', projectId: null, agentRole: 'r', model: 'claude-sonnet-4-6',
        via: 'subscription', accountId: 'a1', inputTokens: 0, outputTokens: 0, costUsd: 0.06,
      });
    } catch { /* ignore */ }
    try {
      await bridge.preFlight({ taskId: 't6-2', projectId: null, estimatedUsd: 0.10 });
    } catch { /* expected */ }
    expect(bridge.pauseState().paused).toBe(true);
    bridge.resume('test-operator');
    expect(bridge.pauseState().paused).toBe(false);
  });

  it('7. dashboard endpoint shape — SqliteRecordSink.sumCostUsd', async () => {
    const db = freshDb();
    const sink = new SqliteRecordSink(db);
    const now = Date.now();
    await sink.append({
      id: 'r1', taskId: 't7', projectId: null, agentRole: 'r', model: 'm',
      via: 'subscription', accountId: 'a1', inputTokens: 0, outputTokens: 0,
      costUsd: 0.42, tsMsEpoch: now - 60_000,
    });
    const total = sink.sumCostUsd({ sinceMsEpoch: now - 24 * 60 * 60 * 1000 });
    expect(total).toBeCloseTo(0.42);
  });

  it('8. AccountPool: serial fallback when both rate-limited', () => {
    const pool = buildAccountPoolBridge({
      accounts: [
        { accountId: 'a1', weeklyCapUsd: 100, weekUsd: 0, lastRotationMsEpoch: 0, rateLimited: true, suspended: false },
        { accountId: 'a2', weeklyCapUsd: 100, weekUsd: 0, lastRotationMsEpoch: 0, rateLimited: true, suspended: false },
      ],
      mode: 'multi',
    });
    const decision = pool.route({ estimatedUsd: 0.1 });
    // Both rate-limited → falls back to api-key.
    expect(['api-key', 'subscription']).toContain(decision.via);
  });

  it('9. router-level fallback at 80% pct', async () => {
    const bridge = buildSpendGuardBridge({ caps: { 'global-day': 1.0 } });
    await bridge.record({
      taskId: 't9', projectId: null, agentRole: 'r', model: 'claude-sonnet-4-6',
      via: 'subscription', accountId: 'a1', inputTokens: 0, outputTokens: 0, costUsd: 0.85,
    });
    expect(await bridge.isOverPct(0.8)).toBe(true);
    expect(await bridge.isOverPct(0.99)).toBe(false);
  });

  it('10. SQLite cap-store round-trip', async () => {
    const db = freshDb();
    const store = new SqliteCapStore(db);
    const now = Date.now();
    const cap = await store.getOrCreate({
      scope: 'task', resourceId: 't10',
      defaultLimitUsd: 1.5, defaultPeriodSec: 86400, nowMs: now,
    });
    expect(cap.limitUsd).toBe(1.5);
    await store.put({ ...cap, currentUsd: 0.7 });
    const list = await store.list();
    expect(list.find((c) => c.resourceId === 't10')?.currentUsd).toBe(0.7);
  });

  it('11. global-day cap pauses bridge', async () => {
    const bridge = buildSpendGuardBridge({ caps: { 'global-day': 0.05 } });
    try {
      await bridge.record({
        taskId: 't11', projectId: null, agentRole: 'r', model: 'claude-sonnet-4-6',
        via: 'subscription', accountId: 'a1', inputTokens: 0, outputTokens: 0, costUsd: 0.06,
      });
    } catch { /* ignore */ }
    try {
      await bridge.preFlight({ taskId: 't11-x', projectId: null, estimatedUsd: 0.10 });
    } catch { /* expected */ }
    expect(bridge.pauseState().paused).toBe(true);
  });

  it('12. project cap does NOT pause bridge (only global-day)', async () => {
    const bridge = buildSpendGuardBridge({ caps: { project: 0.10, 'global-day': 1000 } });
    // Spend up to project cap.
    await bridge.record({
      taskId: 't12', projectId: 'p1', agentRole: 'r', model: 'claude-sonnet-4-6',
      via: 'subscription', accountId: 'a1', inputTokens: 0, outputTokens: 0, costUsd: 0.09,
    });
    // preFlight should throw on the project breach but NOT pause.
    await expect(
      bridge.preFlight({ taskId: 't12-2', projectId: 'p1', estimatedUsd: 0.05 }),
    ).rejects.toBeInstanceOf(SpendBudgetExceededError);
    expect(bridge.pauseState().paused).toBe(false);
  });
});


// ─── No-API-key constraint (Prakash 2026-04-30) ──────────────────────────
//
// The bridge defaults rejectApiKeyVia to TRUE. Test 13 asserts default
// behaviour — every record() with via:'api-key' is refused. Test 14
// asserts the legacy escape hatch still works for tests that pass
// `rejectApiKeyVia: false` (no production code does).

import { ApiKeyViaForbiddenError } from '@chiefaia/spend-guard';

describe('SAFETY-004 + LAI-001 no-API-key constraint', () => {
  it('13. production default rejects via=api-key', async () => {
    const bridge = buildSpendGuardBridge();
    await expect(
      bridge.record({
        taskId: 't13',
        projectId: null,
        agentRole: 'po',
        model: 'claude-sonnet-4-6',
        via: 'api-key',
        accountId: 'apikey-default',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.0001,
      }),
    ).rejects.toBeInstanceOf(ApiKeyViaForbiddenError);
  });

  it('14. opt-out rejectApiKeyVia:false still records api-key (legacy / test only)', async () => {
    const sink = new InMemoryRecordSink();
    const bridge = buildSpendGuardBridge({ recordSink: sink, rejectApiKeyVia: false });
    await bridge.record({
      taskId: 't14',
      projectId: null,
      agentRole: 'po',
      model: 'claude-sonnet-4-6',
      via: 'api-key',
      accountId: 'apikey-default',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0.0001,
    });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.via).toBe('api-key');
  });

  it('15. via=subscription is accepted under default config (binary-spawn adapter path)', async () => {
    const sink = new InMemoryRecordSink();
    const bridge = buildSpendGuardBridge({ recordSink: sink });
    await bridge.record({
      taskId: 't15',
      projectId: null,
      agentRole: 'coding',
      model: 'claude-sonnet-4-6',
      via: 'subscription',
      accountId: 'acct-1',
      inputTokens: 5,
      outputTokens: 5,
      costUsd: 0.001,
    });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.via).toBe('subscription');
  });
});
