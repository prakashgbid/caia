import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeFixture, type FixtureBundle } from './fixtures.js';
import {
  loadContext,
  loadState,
  markDone,
  markFailed,
  markInProgress,
  recordAttemptCompleted,
  type StateContext,
} from '../src/state.js';
import {
  acquireLock,
  checkLockStaleness,
  clearLock,
  hadAnyHeartbeat,
  heartbeat,
  loadLock,
  saveLock,
} from '../src/lock.js';
import { dispatchPhase } from '../src/runner.js';
import type { LockFile } from '../src/types.js';

// Lifecycle test suite — H-2 (attempts semantics) + H-3 (early-exit capture).
//
// Scenarios covered:
//   L01_markInProgress_does_not_increment_attempts
//   L02_markDone_after_heartbeat_increments_attempts
//   L03_markFailed_no_heartbeat_no_log_no_artifact_does_not_increment
//   L04_markFailed_after_heartbeat_increments
//   L05_checkLockStaleness_zero_evidence_no_increment
//   L06_checkLockStaleness_with_heartbeat_increments
//   L07_dispatch_early_exit_binfalse_marks_failed_no_attempts
//   L08_dispatch_sleep_stub_returns_quickly_in_progress
//   L09_recordAttemptCompleted_helper_direct
//   L10_hadAnyHeartbeat_helper

let fx: FixtureBundle;
let ctx: StateContext;

beforeEach(() => {
  fx = makeFixture(`life-${Math.random().toString(36).slice(2, 8)}`);
  ctx = loadContext(fx.chainId, fx.specPath);
});

afterEach(() => {
  fx.cleanup();
});

describe('L01_markInProgress_does_not_increment_attempts', () => {
  it('attempts stays at 0 after first markInProgress', () => {
    markInProgress(ctx, '1', 'sess-l01');
    const state = loadState(ctx);
    expect(state.phase_status['1']?.attempts).toBe(0);
    expect(state.phase_status['1']?.status).toBe('in_progress');
  });

  it('emits attempt_started audit event', () => {
    markInProgress(ctx, '1', 'sess-l01b');
    const lines = readFileSync(ctx.paths.auditFile, 'utf8').trim().split('\n');
    const events = lines.map((ln) => JSON.parse(ln).event as string);
    expect(events).toContain('attempt_started');
    expect(events).toContain('phase_in_progress');
  });
});

describe('L02_markDone_after_heartbeat_increments_attempts_to_1', () => {
  it('attempts=1 after a heartbeat-fired run', () => {
    markInProgress(ctx, '1', 'sess-l02');
    acquireLock(ctx, 1, 'sess-l02');
    const hb = heartbeat(ctx, 'sess-l02');
    expect(hb.kind).toBe('ok');
    markDone(ctx, '1');
    const state = loadState(ctx);
    expect(state.phase_status['1']?.attempts).toBe(1);
    expect(state.phase_status['1']?.status).toBe('done');
  });
});

describe('L03_markFailed_no_heartbeat_no_log_no_artifact_does_not_increment', () => {
  it('ranSubstantively=false leaves attempts at 0', () => {
    markInProgress(ctx, '1', 'sess-l03');
    acquireLock(ctx, 1, 'sess-l03');
    // Mark failed with an explicit ranSubstantively=false (rate-limit shape).
    markFailed(
      ctx,
      '1',
      {
        class: 'worker_no_start_rate_limit',
        reason: 'rate limit hit at dispatch',
        detected_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        evidence: {},
      },
      { ranSubstantively: false },
    );
    const state = loadState(ctx);
    expect(state.phase_status['1']?.attempts).toBe(0);
    expect(state.phase_status['1']?.status).toBe('failed');
  });

  it('default inference: worker_no_start_* class → ranSubstantively=false', () => {
    markInProgress(ctx, '2', 'sess-l03b');
    markFailed(ctx, '2', {
      class: 'worker_no_start_binary_missing',
      reason: 'claude binary missing',
      detected_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      evidence: {},
    });
    const state = loadState(ctx);
    expect(state.phase_status['2']?.attempts).toBe(0);
  });
});

describe('L04_markFailed_after_heartbeat_increments', () => {
  it('explicit ranSubstantively=true bumps attempts', () => {
    markInProgress(ctx, '1', 'sess-l04');
    acquireLock(ctx, 1, 'sess-l04');
    heartbeat(ctx, 'sess-l04');
    markFailed(
      ctx,
      '1',
      {
        class: 'worker_crashed',
        reason: 'SIGSEGV',
        detected_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        evidence: {},
      },
      { ranSubstantively: true },
    );
    const state = loadState(ctx);
    expect(state.phase_status['1']?.attempts).toBe(1);
  });

  it('default inference: non-worker_no_start class → ranSubstantively=true', () => {
    markInProgress(ctx, '1', 'sess-l04b');
    markFailed(ctx, '1', {
      class: 'worker_hung_mid_work',
      reason: 'silent stall',
      detected_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      evidence: {},
    });
    const state = loadState(ctx);
    expect(state.phase_status['1']?.attempts).toBe(1);
  });
});

describe('L05_checkLockStaleness_zero_evidence_no_increment', () => {
  it('staleness clears lock without charging an attempt when no heartbeat fired, no log, no artifact', () => {
    markInProgress(ctx, '1', 'sess-l05');
    acquireLock(ctx, 1, 'sess-l05');
    // Backdate the heartbeat to be older than HEARTBEAT_GRACE_SEC. Use the
    // SAME timestamp for started_at so hadAnyHeartbeat returns false.
    const lock = loadLock(ctx) as LockFile;
    const past = new Date(Date.now() - 4 * 3600 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    saveLock(ctx, { ...lock, started_at: past, heartbeat: past });

    const r = checkLockStaleness(ctx);
    expect(r.kind).toBe('cleared');
    const state = loadState(ctx);
    expect(state.phase_status['1']?.attempts).toBe(0);
  });
});

describe('L06_checkLockStaleness_with_heartbeat_increments', () => {
  it('staleness with heartbeat evidence bumps attempts to 1', () => {
    markInProgress(ctx, '1', 'sess-l06');
    acquireLock(ctx, 1, 'sess-l06');
    // Need a started_at != heartbeat to prove heartbeat() fired. Set both
    // backdated so the staleness path triggers, but with different values.
    const startedPast = new Date(Date.now() - 5 * 3600 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    const hbPast = new Date(Date.now() - 4 * 3600 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    const lock = loadLock(ctx) as LockFile;
    saveLock(ctx, { ...lock, started_at: startedPast, heartbeat: hbPast });

    const r = checkLockStaleness(ctx);
    expect(r.kind).toBe('cleared');
    const state = loadState(ctx);
    expect(state.phase_status['1']?.attempts).toBe(1);
  });
});

describe('L07_dispatch_early_exit_binfalse_marks_failed_no_attempts', () => {
  // `/bin/false` doesn't exist on macOS — falsey binary lives at /usr/bin/false.
  // Use whichever is present so this test works on both Linux and macOS CI.
  const FALSE_BIN = existsSync('/bin/false') ? '/bin/false' : '/usr/bin/false';

  it('early-exit binary triggers markFailed with class=worker_no_start_spawn_error, attempts NOT incremented', async () => {
    const result = await dispatchPhase(ctx, 1, {
      command: FALSE_BIN,
      earlyExitWindowMs: 1500,
    });
    expect(typeof result.early_exit_code).toBe('number');
    expect(result.early_exit_code).not.toBe(0);
    expect(result.early_failure?.class).toBe('worker_no_start_spawn_error');
    const state = loadState(ctx);
    expect(state.phase_status['1']?.status).toBe('failed');
    expect(state.phase_status['1']?.attempts).toBe(0);
    expect(existsSync(ctx.paths.lockFile)).toBe(false);
  });

  it('ENOENT (missing binary) is captured as worker_no_start_spawn_error via error event', async () => {
    const result = await dispatchPhase(ctx, 1, {
      command: '/definitely/not/a/real/binary/caia-chain-test',
      earlyExitWindowMs: 1500,
    });
    expect(typeof result.early_exit_code).toBe('number');
    expect(result.early_exit_code).not.toBe(0);
    expect(result.early_failure?.class).toBe('worker_no_start_spawn_error');
    const state = loadState(ctx);
    expect(state.phase_status['1']?.attempts).toBe(0);
  });
});

describe('L08_dispatch_sleep_stub_returns_quickly_in_progress', () => {
  it('long-running spawn returns within the early-exit window with phase still in_progress', async () => {
    // Use a shell wrapper because dispatchPhase appends phase/session/prompt
    // args to dispatch.args, and `/bin/sleep` errors on non-numeric args.
    // `sh -c <cmd>` ignores positional args after $0, so this just sleeps.
    const t0 = Date.now();
    const result = await dispatchPhase(ctx, 1, {
      command: '/bin/sh',
      args: ['-c', 'sleep 5'],
      earlyExitWindowMs: 300,
    });
    const elapsed = Date.now() - t0;
    expect(result.early_exit_code).toBeUndefined();
    expect(elapsed).toBeLessThan(2000);
    const state = loadState(ctx);
    expect(state.phase_status['1']?.status).toBe('in_progress');
    expect(state.phase_status['1']?.attempts).toBe(0);
    expect(existsSync(ctx.paths.lockFile)).toBe(true);
    // Reap the lingering sh child so the test runner can exit promptly.
    if (result.pid) {
      try {
        process.kill(result.pid, 'SIGKILL');
      } catch {
        // ignore — already gone
      }
    }
    clearLock(ctx);
  });
});

describe('L09_recordAttemptCompleted_helper_direct', () => {
  it('records audit event and does not increment when ranSubstantively=false', () => {
    markInProgress(ctx, '1', 'sess-l09');
    recordAttemptCompleted(ctx, '1', 'sess-l09', false);
    const state = loadState(ctx);
    expect(state.phase_status['1']?.attempts).toBe(0);
    const lines = readFileSync(ctx.paths.auditFile, 'utf8').trim().split('\n');
    const completed = lines
      .map((ln) => JSON.parse(ln))
      .filter((ev) => ev.event === 'attempt_completed');
    expect(completed.length).toBeGreaterThanOrEqual(1);
    const last = completed[completed.length - 1];
    expect(last.ran_substantively).toBe(false);
    expect(last.attempts_after).toBe(0);
  });

  it('increments when ranSubstantively=true', () => {
    markInProgress(ctx, '1', 'sess-l09b');
    recordAttemptCompleted(ctx, '1', 'sess-l09b', true);
    const state = loadState(ctx);
    expect(state.phase_status['1']?.attempts).toBe(1);
  });
});

describe('L10_hadAnyHeartbeat_helper', () => {
  it('returns false when heartbeat == started_at (no heartbeat() call made)', () => {
    acquireLock(ctx, 1, 'sess-l10');
    const lock = loadLock(ctx) as LockFile;
    expect(hadAnyHeartbeat(lock)).toBe(false);
  });

  it('returns true when heartbeat differs from started_at', async () => {
    acquireLock(ctx, 1, 'sess-l10b');
    // Need at least 1s gap (isoNow drops millis).
    await new Promise((r) => setTimeout(r, 1100));
    const r = heartbeat(ctx, 'sess-l10b');
    expect(r.kind).toBe('ok');
    const lock = loadLock(ctx) as LockFile;
    expect(hadAnyHeartbeat(lock)).toBe(true);
  });
});

describe('lifecycle invariants', () => {
  it('audit event sequence on a normal mark-done: attempt_started → phase_in_progress → attempt_completed → phase_done', () => {
    markInProgress(ctx, '1', 'sess-inv');
    markDone(ctx, '1');
    const lines = readFileSync(ctx.paths.auditFile, 'utf8').trim().split('\n');
    const seq = lines.map((ln) => JSON.parse(ln).event as string);
    const idx = (e: string): number => seq.indexOf(e);
    expect(idx('attempt_started')).toBeGreaterThanOrEqual(0);
    expect(idx('phase_in_progress')).toBeGreaterThan(idx('attempt_started'));
    expect(idx('attempt_completed')).toBeGreaterThan(idx('phase_in_progress'));
    expect(idx('phase_done')).toBeGreaterThan(idx('attempt_completed'));
  });

  it('legacy string-reason markFailed still works (back-compat shim)', () => {
    markInProgress(ctx, '1', 'sess-legacy');
    markFailed(ctx, '1', 'something went wrong');
    const state = loadState(ctx);
    expect(state.phase_status['1']?.status).toBe('failed');
    expect(state.phase_status['1']?.failure?.class).toBe('unknown');
    // Default inference for unknown → ranSubstantively=true (conservative).
    expect(state.phase_status['1']?.attempts).toBe(1);
  });
});
