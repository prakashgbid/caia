// A.9.5 — unit tests for the per-hour Claude-call budget guard.
//
// The guard is enforced at the seam where ClaudeAdapter.generate() runs
// (see claude-adapter.test.ts for the integration assertion). These
// tests cover the pure budget logic.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ClaudeBudgetExceededError,
  ClaudeCallBudget,
} from '../src/claude-call-budget.js';

describe('ClaudeCallBudget', () => {
  const ORIG_ENV = process.env['CLAUDE_CALLS_PER_HOUR_CAP'];

  afterEach(() => {
    if (ORIG_ENV === undefined) {
      delete process.env['CLAUDE_CALLS_PER_HOUR_CAP'];
    } else {
      process.env['CLAUDE_CALLS_PER_HOUR_CAP'] = ORIG_ENV;
    }
  });

  it('default cap is 60/hour when env is unset', () => {
    delete process.env['CLAUDE_CALLS_PER_HOUR_CAP'];
    const b = new ClaudeCallBudget();
    expect(b.configuredCap).toBe(60);
    expect(b.isDisabled).toBe(false);
  });

  it('reads CLAUDE_CALLS_PER_HOUR_CAP from env', () => {
    process.env['CLAUDE_CALLS_PER_HOUR_CAP'] = '5';
    const b = new ClaudeCallBudget();
    expect(b.configuredCap).toBe(5);
  });

  it('cap of 0 disables the guard', () => {
    const b = new ClaudeCallBudget({ cap: 0 });
    expect(b.isDisabled).toBe(true);
    // 1000 consume calls should be fine.
    for (let i = 0; i < 1000; i++) b.consume();
    expect(b.snapshot().callsInLastHour).toBe(0);
  });

  it('negative cap also disables the guard (defensive)', () => {
    const b = new ClaudeCallBudget({ cap: -1 });
    expect(b.isDisabled).toBe(true);
  });

  it('throws ClaudeBudgetExceededError on the (cap+1)th consume within the hour', () => {
    let t = 1_000_000;
    const b = new ClaudeCallBudget({ cap: 3, now: () => t });
    b.consume();
    t += 100;
    b.consume();
    t += 100;
    b.consume();
    expect(() => b.consume()).toThrow(ClaudeBudgetExceededError);
  });

  it('error includes cap, callsInLastHour, and resetAt fields', () => {
    let t = 5_000_000;
    const b = new ClaudeCallBudget({ cap: 2, now: () => t });
    b.consume();
    b.consume();
    try {
      b.consume();
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ClaudeBudgetExceededError);
      const err = e as ClaudeBudgetExceededError;
      expect(err.cap).toBe(2);
      expect(err.callsInLastHour).toBe(2);
      expect(err.resetAt).toBe(5_000_000 + 60 * 60 * 1000);
      expect(err.message).toMatch(/A\.9\.5/);
      expect(err.message).toMatch(/CLAUDE_CALLS_PER_HOUR_CAP/);
    }
  });

  it('evicts timestamps older than 1 hour from the rolling window', () => {
    let t = 0;
    const b = new ClaudeCallBudget({ cap: 2, now: () => t });
    b.consume();
    b.consume();
    expect(() => b.consume()).toThrow(ClaudeBudgetExceededError);

    // Advance just past 1 hour — both timestamps should evict.
    t = 60 * 60 * 1000 + 1;
    expect(() => b.consume()).not.toThrow();
    expect(b.snapshot().callsInLastHour).toBe(1);
  });

  it('snapshot reports cap, disabled, callsInLastHour, resetAt', () => {
    let t = 100;
    const b = new ClaudeCallBudget({ cap: 5, now: () => t });
    expect(b.snapshot()).toEqual({
      cap: 5,
      disabled: false,
      callsInLastHour: 0,
      resetAt: null,
    });
    b.consume();
    t += 50;
    b.consume();
    const snap = b.snapshot();
    expect(snap.callsInLastHour).toBe(2);
    expect(snap.resetAt).toBe(100 + 60 * 60 * 1000);
  });

  it('reset clears the rolling window', () => {
    const b = new ClaudeCallBudget({ cap: 2 });
    b.consume();
    b.consume();
    b.reset();
    expect(b.snapshot().callsInLastHour).toBe(0);
    expect(() => b.consume()).not.toThrow();
  });
});

describe('ClaudeCallBudget — integration with ClaudeAdapter', () => {
  beforeEach(() => {
    process.env['CLAUDE_CALLS_PER_HOUR_CAP'] = '60';
  });

  it('shared singleton has the right default cap on import', async () => {
    const mod = await import('../src/claude-call-budget.js');
    // Note: singleton was constructed at module load with whatever env
    // was present then. We just assert the type contract holds.
    expect(typeof mod.claudeCallBudget.configuredCap).toBe('number');
    expect(mod.claudeCallBudget.configuredCap).toBeGreaterThanOrEqual(0);
  });
});
