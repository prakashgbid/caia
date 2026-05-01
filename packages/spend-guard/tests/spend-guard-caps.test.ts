/**
 * SpendGuard — project cap + global-week cap + edge cases not covered by
 * spend-guard.test.ts.
 *
 * All existing tests use `projectId: null`.  These tests exercise the
 * project-cap path and the weekly rollover that are otherwise dead code
 * in CI.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BudgetExceededError,
  InMemoryCapStore,
  InMemoryRecordSink,
  SpendGuard,
  type SpendCapScope,
} from '../src/index.js';

let now = 1_700_000_000_000;
const clock = () => now;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

beforeEach(() => {
  now = 1_700_000_000_000;
});

function makeGuard(capOverrides: Partial<Record<SpendCapScope, number>> = {}) {
  return new SpendGuard({
    capStore: new InMemoryCapStore(),
    recordSink: new InMemoryRecordSink(),
    nowMs: clock,
    caps: {
      task: 1.5,
      project: 5,
      'global-day': 25,
      'global-week': 10,
      ...capOverrides,
    },
  });
}

// ─── Project cap ────────────────────────────────────────────────────────────

describe('SpendGuard — project cap enforcement', () => {
  it('preFlight passes when project spend is below cap', async () => {
    const guard = makeGuard({ project: 5 });
    await guard.record({
      taskId: 't1', projectId: 'proj-a', agentRole: 'coding',
      model: 'claude-sonnet-4-6', via: 'subscription', accountId: 'acct-1',
      inputTokens: 0, outputTokens: 0, costUsd: 2,
    });
    // estimatedUsd=1 stays within task cap (1.5) and project cap (5-2=3 remaining)
    await expect(
      guard.preFlight({ taskId: 't2', projectId: 'proj-a', estimatedUsd: 1 }),
    ).resolves.toBeUndefined();
  });

  it('preFlight throws BudgetExceededError when project cap would be exceeded', async () => {
    const guard = makeGuard({ project: 3 });
    await guard.record({
      taskId: 't1', projectId: 'proj-a', agentRole: 'coding',
      model: 'claude-sonnet-4-6', via: 'subscription', accountId: 'acct-1',
      inputTokens: 0, outputTokens: 0, costUsd: 2.5,
    });
    // 2.5 + 1.0 = 3.5 > 3 → should throw
    await expect(
      guard.preFlight({ taskId: 't2', projectId: 'proj-a', estimatedUsd: 1 }),
    ).rejects.toThrow(BudgetExceededError);
  });

  it('project caps are isolated: proj-a breach does not block proj-b', async () => {
    const guard = makeGuard({ project: 2 });
    await guard.record({
      taskId: 't1', projectId: 'proj-a', agentRole: 'coding',
      model: 'claude-sonnet-4-6', via: 'subscription', accountId: 'acct-1',
      inputTokens: 0, outputTokens: 0, costUsd: 1.9,
    });
    // proj-a has 0.1 remaining; proj-b is untouched
    await expect(
      guard.preFlight({ taskId: 't2', projectId: 'proj-b', estimatedUsd: 1.5 }),
    ).resolves.toBeUndefined();
  });

  it('null projectId skips the project-cap check entirely', async () => {
    // project cap is extremely low; projectId=null means it is never consulted
    const guard = makeGuard({ project: 0.001 });
    await expect(
      guard.preFlight({ taskId: 't1', projectId: null, estimatedUsd: 1 }),
    ).resolves.toBeUndefined();
  });

  it('record with non-null projectId increments the project cap bucket', async () => {
    const guard = makeGuard({ project: 1 });
    await guard.record({
      taskId: 't1', projectId: 'proj-x', agentRole: 'coding',
      model: 'claude-sonnet-4-6', via: 'subscription', accountId: 'acct-1',
      inputTokens: 0, outputTokens: 0, costUsd: 0.9,
    });
    // 0.9 used; 0.2 more would exceed 1
    await expect(
      guard.preFlight({ taskId: 't2', projectId: 'proj-x', estimatedUsd: 0.2 }),
    ).rejects.toThrow(BudgetExceededError);
  });
});

// ─── Global-week cap ─────────────────────────────────────────────────────────

describe('SpendGuard — global-week cap enforcement', () => {
  it('preFlight throws BudgetExceededError when global-week cap is exceeded', async () => {
    const guard = makeGuard({ 'global-week': 3, 'global-day': 100 });
    await guard.record({
      taskId: 't1', projectId: null, agentRole: 'coding',
      model: 'claude-sonnet-4-6', via: 'subscription', accountId: 'acct-1',
      inputTokens: 0, outputTokens: 0, costUsd: 2.5,
    });
    // 2.5 + 1 = 3.5 > 3 → should throw
    await expect(
      guard.preFlight({ taskId: 't2', projectId: null, estimatedUsd: 1 }),
    ).rejects.toThrow(BudgetExceededError);
  });

  it('global-week cap resets after 7 days elapse', async () => {
    // Raise task cap so it doesn't interfere with the week-reset check.
    const guard = makeGuard({ task: 10, 'global-week': 3, 'global-day': 100 });
    await guard.record({
      taskId: 't', projectId: null, agentRole: 'coding',
      model: 'claude-sonnet-4-6', via: 'subscription', accountId: 'acct-1',
      inputTokens: 0, outputTokens: 0, costUsd: 2.8,
    });
    // advance > 7 days → weekly counter resets
    now += WEEK_MS + DAY_MS;
    // After reset, spending 2.8 again is fine (fresh week window)
    await expect(
      guard.preFlight({ taskId: 't2', projectId: null, estimatedUsd: 2.8 }),
    ).resolves.toBeUndefined();
  });
});

// ─── Resume guard ─────────────────────────────────────────────────────────────

describe('SpendGuard — resume when already unpaused', () => {
  it('resume() is a no-op when the guard is not paused', () => {
    const guard = makeGuard();
    expect(guard.pause.paused).toBe(false);
    expect(() => guard.resume('operator')).not.toThrow();
    expect(guard.pause.paused).toBe(false);
  });

  it('resume() does not emit a resumed log event when not paused', () => {
    const events: Array<{ kind: string }> = [];
    const guard = new SpendGuard({
      capStore: new InMemoryCapStore(),
      recordSink: new InMemoryRecordSink(),
      log: (ev) => events.push(ev as { kind: string }),
    });
    guard.resume('operator');
    expect(events.some((e) => e.kind === 'resumed')).toBe(false);
  });
});

// ─── _peekPause helper ────────────────────────────────────────────────────────

describe('SpendGuard._peekPause', () => {
  it('returns paused=false when no cap has been breached', () => {
    const guard = makeGuard();
    expect(guard._peekPause().paused).toBe(false);
    expect(guard._peekPause().reason).toBeNull();
    expect(guard._peekPause().sinceMsEpoch).toBeNull();
  });

  it('returns paused=true with reason and timestamp after global-day breach', async () => {
    const guard = makeGuard({ 'global-day': 0.5 });
    await guard.record({
      taskId: 't', projectId: null, agentRole: 'coding',
      model: 'claude-sonnet-4-6', via: 'subscription', accountId: 'acct-1',
      inputTokens: 0, outputTokens: 0, costUsd: 0.4,
    });
    await guard.preFlight({ taskId: 't2', projectId: null, estimatedUsd: 0.2 }).catch(() => undefined);
    const peek = guard._peekPause();
    expect(peek.paused).toBe(true);
    expect(typeof peek.reason).toBe('string');
    expect(typeof peek.sinceMsEpoch).toBe('number');
  });
});

// ─── dailySpendPctOver edge cases ─────────────────────────────────────────────

describe('SpendGuard.dailySpendPctOver — edge cases', () => {
  it('returns false when no spend has been recorded yet and threshold is positive', async () => {
    const guard = makeGuard();
    // 0 / 25 = 0.0 which is less than 0.5 → false
    expect(await guard.dailySpendPctOver(0.5)).toBe(false);
  });

  it('returns true at exactly 100% of the daily cap', async () => {
    const guard = makeGuard({ 'global-day': 1, 'global-week': 999 });
    await guard.record({
      taskId: 't', projectId: null, agentRole: 'coding',
      model: 'claude-sonnet-4-6', via: 'subscription', accountId: 'acct-1',
      inputTokens: 0, outputTokens: 0, costUsd: 1.0,
    });
    expect(await guard.dailySpendPctOver(1.0)).toBe(true);
  });

  it('returns false at 79% when threshold is 80%', async () => {
    const guard = makeGuard({ 'global-day': 10, 'global-week': 999 });
    await guard.record({
      taskId: 't', projectId: null, agentRole: 'coding',
      model: 'claude-sonnet-4-6', via: 'subscription', accountId: 'acct-1',
      inputTokens: 0, outputTokens: 0, costUsd: 7.9,
    });
    expect(await guard.dailySpendPctOver(0.8)).toBe(false);
  });
});
