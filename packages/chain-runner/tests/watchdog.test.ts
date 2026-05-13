import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  attemptReRegister,
  detectStall,
  recordStallDetected,
  type StallCheckResult,
} from '../src/watchdog.js';
import {
  findWakeAfter,
  retryWithBackoff,
  verifyBootstrap,
} from '../src/bootstrap.js';
import { makeFixture, type FixtureBundle } from './fixtures.js';
import {
  initState,
  loadContext,
  loadState,
  recordWake,
  saveState,
  type StateContext,
} from '../src/state.js';
import type { StateFile } from '../src/types.js';

// ---------- detectStall ----------

function freshState(overrides: Partial<StateFile> = {}): StateFile {
  return {
    schema_version: 1,
    started_at: new Date(Date.now() - 60_000).toISOString(),
    last_wake: null,
    paused: false,
    budget_consumed_pct: 0,
    budget_cap_pct: 25,
    phase_status: {},
    current_phase: null,
    all_done: false,
    ...overrides,
  };
}

describe('detectStall', () => {
  it('reports healthy when last_wake is recent', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const state = freshState({
      last_wake: new Date(now.getTime() - 60_000).toISOString(),
    });
    const r = detectStall(state, { wakeIntervalSec: 900, now: () => now });
    expect(r.stalled).toBe(false);
    expect(r.reason).toBe('healthy');
    expect(r.ageSec).toBeLessThan(r.thresholdSec);
  });

  it('reports wake_overdue when last_wake is older than 2x interval', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const state = freshState({
      last_wake: new Date(now.getTime() - 3 * 900 * 1000).toISOString(),
    });
    const r = detectStall(state, { wakeIntervalSec: 900, now: () => now });
    expect(r.stalled).toBe(true);
    expect(r.reason).toBe('wake_overdue');
    expect(r.ageSec).toBeGreaterThan(r.thresholdSec);
  });

  it('reports never_waked when last_wake is null and started_at is old', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const state = freshState({
      started_at: new Date(now.getTime() - 4 * 900 * 1000).toISOString(),
      last_wake: null,
    });
    const r = detectStall(state, { wakeIntervalSec: 900, now: () => now });
    expect(r.stalled).toBe(true);
    expect(r.reason).toBe('never_waked');
    expect(r.lastWake).toBeNull();
  });

  it('stays healthy when last_wake null but started_at is recent', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const state = freshState({
      started_at: new Date(now.getTime() - 60_000).toISOString(),
      last_wake: null,
    });
    const r = detectStall(state, { wakeIntervalSec: 900, now: () => now });
    expect(r.stalled).toBe(false);
    expect(r.reason).toBe('healthy');
  });

  it('honours custom multiplier', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const state = freshState({
      last_wake: new Date(now.getTime() - 1500 * 1000).toISOString(),
    });
    // 1500s age, 900s interval → 1.67x; multiplier=3 means threshold=2700s, healthy
    const r1 = detectStall(state, {
      wakeIntervalSec: 900,
      multiplier: 3,
      now: () => now,
    });
    expect(r1.stalled).toBe(false);
    // multiplier=1 means threshold=900s, stalled
    const r2 = detectStall(state, {
      wakeIntervalSec: 900,
      multiplier: 1,
      now: () => now,
    });
    expect(r2.stalled).toBe(true);
  });

  it('rejects invalid wakeIntervalSec', () => {
    expect(() => detectStall(freshState(), { wakeIntervalSec: 0 })).toThrow();
    expect(() => detectStall(freshState(), { wakeIntervalSec: -1 })).toThrow();
  });
});

// ---------- recordStallDetected ----------

describe('recordStallDetected', () => {
  let fx: FixtureBundle;
  let ctx: StateContext;
  beforeEach(() => {
    fx = makeFixture(`stall-${Math.random().toString(36).slice(2, 8)}`);
    ctx = loadContext(fx.chainId, fx.specPath);
    initState(ctx);
  });
  afterEach(() => fx.cleanup());

  it('writes audit event with stall metadata', () => {
    const result: StallCheckResult = {
      stalled: true,
      lastWake: '2026-05-13T10:00:00Z',
      ageSec: 7200,
      thresholdSec: 1800,
      reason: 'wake_overdue',
    };
    recordStallDetected(ctx, result);
    const audit = readFileSync(ctx.paths.auditFile, 'utf8');
    expect(audit).toContain('"event":"cron_stall_detected"');
    expect(audit).toContain('"age_sec":7200');
    expect(audit).toContain('"threshold_sec":1800');
    expect(audit).toContain('"reason":"wake_overdue"');
  });

  it('appends INBOX.md alert when inboxPath given', () => {
    const inboxDir = mkdtempSync(join(tmpdir(), 'inbox-test-'));
    const inboxPath = join(inboxDir, 'INBOX.md');
    try {
      const result: StallCheckResult = {
        stalled: true,
        lastWake: null,
        ageSec: 9999,
        thresholdSec: 1800,
        reason: 'never_waked',
      };
      recordStallDetected(ctx, result, { inboxPath, chainId: 'sample-chain' });
      expect(existsSync(inboxPath)).toBe(true);
      const body = readFileSync(inboxPath, 'utf8');
      expect(body).toContain('cron_stall_detected');
      expect(body).toContain('sample-chain');
      expect(body).toContain('never');
      expect(body).toContain('1800s');
    } finally {
      rmSync(inboxDir, { recursive: true, force: true });
    }
  });
});

// ---------- attemptReRegister ----------

describe('attemptReRegister', () => {
  let fx: FixtureBundle;
  let ctx: StateContext;
  beforeEach(() => {
    fx = makeFixture(`rereg-${Math.random().toString(36).slice(2, 8)}`);
    ctx = loadContext(fx.chainId, fx.specPath);
    initState(ctx);
  });
  afterEach(() => fx.cleanup());

  it('is a no-op without a command', () => {
    const r = attemptReRegister(undefined, ctx);
    expect(r.attempted).toBe(false);
    const audit = readFileSync(ctx.paths.auditFile, 'utf8');
    expect(audit).toContain('cron_reregister_skipped');
  });

  it('runs spawn fn and reports success', () => {
    const r = attemptReRegister(
      { command: '/bin/true', args: [], spawn: () => ({ status: 0 }) },
      ctx,
    );
    expect(r.attempted).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    const audit = readFileSync(ctx.paths.auditFile, 'utf8');
    expect(audit).toContain('"event":"cron_reregister_attempted"');
    expect(audit).toContain('"ok":true');
  });

  it('reports failure when spawn returns non-zero', () => {
    const r = attemptReRegister(
      {
        command: '/bin/false',
        args: [],
        spawn: () => ({ status: 7, stderr: 'boom' }),
      },
      ctx,
    );
    expect(r.attempted).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(7);
    expect(r.stderr).toBe('boom');
  });
});

// ---------- retryWithBackoff ----------

describe('retryWithBackoff', () => {
  it('returns on first success without sleeping', async () => {
    const sleeps: number[] = [];
    const result = await retryWithBackoff(() => 'ok', {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result).toBe('ok');
    expect(sleeps).toEqual([]);
  });

  it('retries with default backoff and eventually succeeds', async () => {
    let attempt = 0;
    const sleeps: number[] = [];
    const result = await retryWithBackoff(
      () => {
        attempt += 1;
        if (attempt < 3) throw new Error(`fail ${attempt}`);
        return 'win';
      },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(result).toBe('win');
    expect(attempt).toBe(3);
    expect(sleeps).toEqual([5_000, 15_000]);
  });

  it('exhausts retries and throws the last error', async () => {
    let attempt = 0;
    const sleeps: number[] = [];
    await expect(
      retryWithBackoff(
        () => {
          attempt += 1;
          throw new Error(`fail ${attempt}`);
        },
        {
          sleep: async (ms) => {
            sleeps.push(ms);
          },
        },
      ),
    ).rejects.toThrow(/fail 4/);
    expect(attempt).toBe(4);
    expect(sleeps).toEqual([5_000, 15_000, 45_000]);
  });

  it('honours custom backoff schedule', async () => {
    let attempt = 0;
    const sleeps: number[] = [];
    await expect(
      retryWithBackoff(
        () => {
          attempt += 1;
          throw new Error('nope');
        },
        {
          backoffMs: [10, 20],
          sleep: async (ms) => {
            sleeps.push(ms);
          },
        },
      ),
    ).rejects.toThrow();
    expect(attempt).toBe(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it('respects maxAttempts override', async () => {
    let attempt = 0;
    await expect(
      retryWithBackoff(
        () => {
          attempt += 1;
          throw new Error('nope');
        },
        {
          backoffMs: [1, 1, 1, 1, 1],
          maxAttempts: 2,
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow();
    expect(attempt).toBe(2);
  });

  it('invokes onRetry hook on each retry', async () => {
    const log: string[] = [];
    let attempt = 0;
    await expect(
      retryWithBackoff(
        () => {
          attempt += 1;
          throw new Error(`fail ${attempt}`);
        },
        {
          backoffMs: [10, 20],
          sleep: async () => {},
          onRetry: (a, err, delay) => {
            log.push(`a=${a} err=${(err as Error).message} delay=${delay}`);
          },
        },
      ),
    ).rejects.toThrow();
    expect(log).toEqual([
      'a=1 err=fail 1 delay=10',
      'a=2 err=fail 2 delay=20',
    ]);
  });
});

// ---------- verifyBootstrap ----------

describe('verifyBootstrap', () => {
  let fx: FixtureBundle;
  let ctx: StateContext;
  beforeEach(() => {
    fx = makeFixture(`vboot-${Math.random().toString(36).slice(2, 8)}`);
    ctx = loadContext(fx.chainId, fx.specPath);
    initState(ctx);
  });
  afterEach(() => fx.cleanup());

  it('returns ok=true when a wake lands during the poll loop', async () => {
    let elapsed = 0;
    const since = new Date('2026-05-13T12:00:00Z');
    // Schedule a wake event to be appended after the first poll sleep.
    const result = await verifyBootstrap(ctx, {
      maxWaitMs: 30_000,
      pollIntervalMs: 5_000,
      since,
      now: () => new Date(since.getTime() + elapsed),
      sleep: async (ms) => {
        elapsed += ms;
        if (elapsed >= 5_000) {
          // Inject a wake event into audit.jsonl
          const wakeTs = new Date(since.getTime() + 6_000).toISOString();
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const fs = require('node:fs') as typeof import('node:fs');
          fs.appendFileSync(
            ctx.paths.auditFile,
            `${JSON.stringify({ ts: wakeTs, event: 'wake' })}\n`,
          );
        }
      },
    });
    expect(result.ok).toBe(true);
    expect(result.observedWakeAt).not.toBeNull();
  });

  it('returns ok=false on timeout', async () => {
    let elapsed = 0;
    const since = new Date('2026-05-13T12:00:00Z');
    const result = await verifyBootstrap(ctx, {
      maxWaitMs: 30_000,
      pollIntervalMs: 10_000,
      since,
      now: () => new Date(since.getTime() + elapsed),
      sleep: async (ms) => {
        elapsed += ms;
      },
    });
    expect(result.ok).toBe(false);
    expect(result.observedWakeAt).toBeNull();
    expect(result.waitedMs).toBe(30_000);
  });

  it('ignores wake events older than `since`', async () => {
    // Stamp an old wake event before starting verification.
    recordWake(ctx);
    const state = loadState(ctx);
    const oldWakeTs = state.last_wake!;
    const since = new Date(Date.parse(oldWakeTs) + 1000);
    let elapsed = 0;
    const result = await verifyBootstrap(ctx, {
      maxWaitMs: 20_000,
      pollIntervalMs: 10_000,
      since,
      now: () => new Date(since.getTime() + elapsed),
      sleep: async (ms) => {
        elapsed += ms;
      },
    });
    expect(result.ok).toBe(false);
  });

  it('findWakeAfter returns the first matching event', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    fs.appendFileSync(
      ctx.paths.auditFile,
      `${JSON.stringify({ ts: '2026-05-13T11:00:00Z', event: 'wake' })}\n` +
        `${JSON.stringify({ ts: '2026-05-13T12:00:00Z', event: 'wake' })}\n`,
    );
    const got = findWakeAfter(ctx, new Date('2026-05-13T11:30:00Z'));
    expect(got).toBe('2026-05-13T12:00:00Z');
    const none = findWakeAfter(ctx, new Date('2026-05-13T12:30:00Z'));
    expect(none).toBeNull();
  });
});

// ---------- integration smoke: state→detectStall round trip ----------

describe('watchdog integration with real state', () => {
  let fx: FixtureBundle;
  let ctx: StateContext;
  beforeEach(() => {
    fx = makeFixture(`int-${Math.random().toString(36).slice(2, 8)}`);
    ctx = loadContext(fx.chainId, fx.specPath);
    initState(ctx);
  });
  afterEach(() => fx.cleanup());

  it('detects stall after backdating last_wake', () => {
    const state = loadState(ctx);
    state.last_wake = new Date(Date.now() - 3600 * 1000).toISOString();
    saveState(ctx, state);
    const r = detectStall(loadState(ctx), { wakeIntervalSec: 900 });
    expect(r.stalled).toBe(true);
  });
});
