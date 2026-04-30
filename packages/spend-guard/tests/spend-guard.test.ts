/**
 * SpendGuard — pre-flight cap checks + auto-pause + record + reset.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BudgetExceededError,
  InMemoryCapStore,
  InMemoryRecordSink,
  SpendGuard,
} from '../src/index.js';

let now = 1_700_000_000_000;
const clock = () => now;

let capStore: InMemoryCapStore;
let recordSink: InMemoryRecordSink;
let guard: SpendGuard;
let log: Array<{ kind: string; [k: string]: unknown }>;

beforeEach(() => {
  now = 1_700_000_000_000;
  capStore = new InMemoryCapStore();
  recordSink = new InMemoryRecordSink();
  log = [];
  guard = new SpendGuard({
    capStore,
    recordSink,
    nowMs: clock,
    log: (ev) => log.push(ev as { kind: string }),
    caps: {
      task: 1.5,
      project: 30,
      'global-day': 25,
      'global-week': 100,
    },
  });
});

describe('SpendGuard.preFlight', () => {
  it('passes when no caps are at risk', async () => {
    await expect(
      guard.preFlight({ taskId: 't', projectId: null, estimatedUsd: 0.1 }),
    ).resolves.toBeUndefined();
  });

  it('rejects when the per-task cap would be exceeded', async () => {
    await guard.record({
      taskId: 't',
      projectId: null,
      agentRole: 'coding',
      model: 'claude-sonnet-4-6',
      via: 'subscription',
      accountId: 'acct-1',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 1.4,
    });
    await expect(
      guard.preFlight({ taskId: 't', projectId: null, estimatedUsd: 0.5 }),
    ).rejects.toThrow(BudgetExceededError);
  });

  it('pauses the orchestrator on global-day breach', async () => {
    await guard.record({
      taskId: 't',
      projectId: null,
      agentRole: 'coding',
      model: 'claude-opus-4-7',
      via: 'subscription',
      accountId: 'acct-1',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 24.5,
    });
    await expect(
      guard.preFlight({ taskId: 't2', projectId: null, estimatedUsd: 1.0 }),
    ).rejects.toThrow(BudgetExceededError);
    expect(guard.pause.paused).toBe(true);
    expect(log.find((e) => e.kind === 'paused')).toBeTruthy();
  });

  it('refuses every subsequent request while paused', async () => {
    await guard.record({
      taskId: 't',
      projectId: null,
      agentRole: 'coding',
      model: 'claude-opus-4-7',
      via: 'subscription',
      accountId: 'acct-1',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 26,
    });
    await expect(
      guard.preFlight({ taskId: 't', projectId: null, estimatedUsd: 0.01 }),
    ).rejects.toThrow();
    await expect(
      guard.preFlight({ taskId: 't2', projectId: null, estimatedUsd: 0.01 }),
    ).rejects.toThrow();
  });

  it('resumes only via explicit operator action', async () => {
    // Spread cost across many tasks so global-day accumulates without
    // any per-task cap getting hit first.
    for (let i = 0; i < 20; i++) {
      await guard.record({
        taskId: `t-spread-${i}`,
        projectId: null,
        agentRole: 'coding',
        model: 'claude-sonnet-4-6',
        via: 'subscription',
        accountId: 'acct-1',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 1.4,
      });
    }
    await guard
      .preFlight({
        taskId: 't-pf',
        projectId: null,
        estimatedUsd: 0.01,
      })
      .catch(() => undefined);
    expect(guard.pause.paused).toBe(true);
    guard.resume('prakash');
    expect(guard.pause.paused).toBe(false);
    expect(log.find((e) => e.kind === 'resumed')).toBeTruthy();
  });

  it('resets a cap when its period elapses', async () => {
    await guard.record({
      taskId: 't',
      projectId: null,
      agentRole: 'coding',
      model: 'claude-sonnet-4-6',
      via: 'subscription',
      accountId: 'acct-1',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 1.4,
    });
    // Advance > 24h
    now += 25 * 60 * 60 * 1000;
    await expect(
      guard.preFlight({ taskId: 't', projectId: null, estimatedUsd: 1.4 }),
    ).resolves.toBeUndefined();
  });
});

describe('SpendGuard.record + ollama path', () => {
  it('does not increment caps when via=ollama', async () => {
    await guard.record({
      taskId: 't',
      projectId: null,
      agentRole: 'coding',
      model: 'qwen-2.5-coder',
      via: 'ollama',
      accountId: null,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      costUsd: 0,
    });
    await expect(
      guard.preFlight({ taskId: 't', projectId: null, estimatedUsd: 1.0 }),
    ).resolves.toBeUndefined();
  });

  it('persists the spend record sink-side regardless of via', async () => {
    await guard.record({
      taskId: 't',
      projectId: null,
      agentRole: 'coding',
      model: 'qwen',
      via: 'ollama',
      accountId: null,
      inputTokens: 100,
      outputTokens: 100,
      costUsd: 0,
    });
    await guard.record({
      taskId: 't',
      projectId: null,
      agentRole: 'coding',
      model: 'claude-sonnet-4-6',
      via: 'api-key',
      accountId: 'apikey-default',
      inputTokens: 100,
      outputTokens: 100,
      costUsd: 0.001,
    });
    expect(recordSink.records).toHaveLength(2);
    expect(recordSink.records[0]?.via).toBe('ollama');
    expect(recordSink.records[1]?.via).toBe('api-key');
  });
});

describe('SpendGuard.dailySpendPctOver', () => {
  it('returns true once daily spend crosses 80% of cap', async () => {
    await guard.record({
      taskId: 't',
      projectId: null,
      agentRole: 'coding',
      model: 'claude-sonnet-4-6',
      via: 'subscription',
      accountId: 'acct-1',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 19.9,
    });
    expect(await guard.dailySpendPctOver(0.8)).toBe(false);
    await guard.record({
      taskId: 't',
      projectId: null,
      agentRole: 'coding',
      model: 'claude-sonnet-4-6',
      via: 'subscription',
      accountId: 'acct-1',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0.5,
    });
    expect(await guard.dailySpendPctOver(0.8)).toBe(true);
  });
});
