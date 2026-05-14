import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { makeFixture, type FixtureBundle } from './fixtures.js';
import {
  initState,
  loadContext,
  loadState,
  markInProgress,
  recordWake,
  saveState,
  type StateContext,
} from '../src/state.js';
import {
  acquireLock,
  checkLockStaleness,
  clearLock,
  loadLock,
  saveLock,
  SLEEP_WAKE_LAST_WAKE_RECENT_SEC,
  SLEEP_WAKE_LOCK_AGE_SUSPECT_SEC,
} from '../src/lock.js';
import {
  flockSidecarPath,
  isFlockEnabled,
  withStateFlock,
  type FlockHolder,
} from '../src/state-flock.js';
import type { LockFile } from '../src/types.js';

// H-22..H-25 tests (chain-runner-battle-harden phase 11, 2026-05-14).
// Concurrency safety bundle: state file-lock, lock ownership token, lock
// checksum/backup, sleep/wake awareness.

describe('cluster A — concurrency safety', () => {
  let bundle: FixtureBundle;
  let ctx: StateContext;

  beforeEach(() => {
    bundle = makeFixture('concurrency');
    ctx = loadContext(bundle.chainId, bundle.specPath);
    initState(ctx);
    delete process.env['CAIA_STATE_FLOCK'];
  });

  afterEach(() => {
    delete process.env['CAIA_STATE_FLOCK'];
    bundle.cleanup();
  });

  // -------------------------------------------------------------------------
  // H-22 — state-flock
  // -------------------------------------------------------------------------
  describe('H-22 state-flock', () => {
    it('isFlockEnabled is false by default and true when env-flag set', () => {
      expect(isFlockEnabled()).toBe(false);
      process.env['CAIA_STATE_FLOCK'] = '1';
      expect(isFlockEnabled()).toBe(true);
      delete process.env['CAIA_STATE_FLOCK'];
      expect(isFlockEnabled({ force: true })).toBe(true);
    });

    it('runs the closure directly when flock is disabled', () => {
      let ran = false;
      withStateFlock(ctx.paths.stateFile, () => {
        ran = true;
      });
      expect(ran).toBe(true);
      // No sidecar should remain on disk.
      expect(existsSync(flockSidecarPath(ctx.paths.stateFile))).toBe(false);
    });

    it('serializes via O_EXCL when forced', () => {
      const saw: string[] = [];
      withStateFlock(
        ctx.paths.stateFile,
        () => {
          saw.push('a');
        },
        { force: true, tag: 'a' },
      );
      withStateFlock(
        ctx.paths.stateFile,
        () => {
          saw.push('b');
        },
        { force: true, tag: 'b' },
      );
      expect(saw).toEqual(['a', 'b']);
      // Sidecar should be cleaned up after each call.
      expect(existsSync(flockSidecarPath(ctx.paths.stateFile))).toBe(false);
    });

    it('steals a stale lock from a dead PID', async () => {
      const sidecar = flockSidecarPath(ctx.paths.stateFile);
      // Spawn + immediately kill a child to obtain a guaranteed-dead PID.
      const cp = await import('node:child_process');
      const child = cp.spawnSync('/bin/sh', ['-c', 'echo $$']);
      // The shell already exited; its PID is now dead. Use it.
      const deadPid = child.pid ?? 999999;
      writeFileSync(
        sidecar,
        JSON.stringify({ pid: deadPid, iso: '2000-01-01T00:00:00Z', tag: 'ghost' }),
      );
      const steals: { holder: FlockHolder | null; reason: string }[] = [];
      withStateFlock(
        ctx.paths.stateFile,
        () => {
          // closure runs after steal
        },
        {
          force: true,
          tag: 'stealer',
          maxWaitMs: 1000,
          onStaleSteal: (holder, reason) => {
            steals.push({ holder, reason });
          },
        },
      );
      expect(steals.length).toBeGreaterThanOrEqual(1);
      expect(steals[0]!.reason).toBe('pid_dead');
      expect(steals[0]!.holder?.tag).toBe('ghost');
    });

    it('steals a corrupt sidecar (unparseable JSON)', () => {
      const sidecar = flockSidecarPath(ctx.paths.stateFile);
      writeFileSync(sidecar, '!!! not json !!!');
      let stealReason: string | null = null;
      withStateFlock(
        ctx.paths.stateFile,
        () => {
          // ran
        },
        {
          force: true,
          tag: 'stealer',
          onStaleSteal: (_h, reason) => {
            stealReason = reason;
          },
        },
      );
      expect(stealReason).toBe('unparseable');
    });

    it('emits state_flock_stolen audit event when saveState steals a corrupt sidecar', () => {
      process.env['CAIA_STATE_FLOCK'] = '1';
      const sidecar = flockSidecarPath(ctx.paths.stateFile);
      writeFileSync(sidecar, 'corrupt-not-json');
      const state = loadState(ctx);
      saveState(ctx, state);
      delete process.env['CAIA_STATE_FLOCK'];
      const lines = readFileSync(ctx.paths.auditFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(
        lines.some((e) => e.event === 'state_flock_stolen'),
      ).toBe(true);
    });

    it('serializes 10 concurrent in-process saveStates without losing writes', async () => {
      process.env['CAIA_STATE_FLOCK'] = '1';
      const N = 10;
      // Each concurrent writer runs a load-mutate-save cycle on a distinct
      // budget value. Without flock these would race; with flock they must
      // serialize and the final value is the LAST writer's value (whichever
      // wins the lock last). The crucial assertion: state is not corrupted
      // and the final value is one of the N values written.
      const seen: number[] = [];
      const writers = Array.from({ length: N }, (_, i) =>
        Promise.resolve().then(() => {
          const s = loadState(ctx);
          s.budget_consumed_pct = i + 1;
          saveState(ctx, s);
          seen.push(i + 1);
        }),
      );
      await Promise.all(writers);
      delete process.env['CAIA_STATE_FLOCK'];
      const finalState = loadState(ctx);
      // Every writer ran (no exceptions, no lost writes).
      expect(seen.length).toBe(N);
      // The final value is one of the values written (no torn writes).
      expect(seen).toContain(finalState.budget_consumed_pct);
      expect(finalState.budget_consumed_pct).toBeGreaterThanOrEqual(1);
      expect(finalState.budget_consumed_pct).toBeLessThanOrEqual(N);
    });
  });

  // -------------------------------------------------------------------------
  // H-23 — clearLock ownership token
  // -------------------------------------------------------------------------
  describe('H-23 clearLock ownership token', () => {
    it('clears when sessionId matches', () => {
      acquireLock(ctx, 1, 'sess-owner');
      const r = clearLock(ctx, 'sess-owner');
      expect(r.kind).toBe('cleared');
      expect(loadLock(ctx)).toBeNull();
    });

    it('refuses on session_id mismatch', () => {
      acquireLock(ctx, 1, 'sess-owner');
      const r = clearLock(ctx, 'sess-stranger');
      expect(r.kind).toBe('mismatch');
      if (r.kind === 'mismatch') {
        expect(r.ownerSession).toBe('sess-owner');
      }
      // Lock is still there.
      expect(loadLock(ctx)?.session_id).toBe('sess-owner');
    });

    it('emits lock_clear_refused audit on mismatch', () => {
      acquireLock(ctx, 1, 'sess-owner');
      clearLock(ctx, 'sess-stranger');
      const lines = readFileSync(ctx.paths.auditFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      const refused = lines.find((e) => e.event === 'lock_clear_refused');
      expect(refused).toBeDefined();
      expect(refused.requested_session).toBe('sess-stranger');
      expect(refused.owner_session).toBe('sess-owner');
    });

    it('force=true unlinks regardless of mismatch', () => {
      acquireLock(ctx, 1, 'sess-owner');
      const r = clearLock(ctx, 'sess-stranger', { force: true });
      expect(r.kind).toBe('cleared');
      expect(loadLock(ctx)).toBeNull();
    });

    it('returns no_lock when no lockfile exists', () => {
      const r = clearLock(ctx, 'sess-anyone');
      expect(r.kind).toBe('no_lock');
    });

    it('omitting sessionId still unlinks (back-compat path)', () => {
      acquireLock(ctx, 1, 'sess-owner');
      const r = clearLock(ctx);
      expect(r.kind).toBe('cleared');
      expect(loadLock(ctx)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // H-24 — lock checksum + backup
  // -------------------------------------------------------------------------
  describe('H-24 lock checksum + backup', () => {
    it('saveLock stamps a checksum that loadLock verifies', () => {
      acquireLock(ctx, 1, 'sess-cksum');
      const raw = JSON.parse(readFileSync(ctx.paths.lockFile, 'utf8')) as LockFile;
      expect(typeof raw.checksum).toBe('string');
      expect(raw.checksum?.length).toBeGreaterThan(40);
      // loadLock should accept the lock.
      const lock = loadLock(ctx);
      expect(lock).not.toBeNull();
      expect(lock?.session_id).toBe('sess-cksum');
    });

    it('loadLock detects a tampered checksum and backs up the corrupt file', () => {
      acquireLock(ctx, 1, 'sess-tamper');
      const raw = JSON.parse(readFileSync(ctx.paths.lockFile, 'utf8')) as LockFile;
      // Tamper the session_id without recomputing checksum.
      const tampered = { ...raw, session_id: 'sess-tampered' };
      writeFileSync(ctx.paths.lockFile, JSON.stringify(tampered));
      const lock = loadLock(ctx);
      expect(lock).toBeNull();
      const lines = readFileSync(ctx.paths.auditFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      const corrupt = lines.find((e) => e.event === 'lock_corrupt_detected');
      expect(corrupt).toBeDefined();
      expect(corrupt.reason).toBe('checksum_mismatch');
      expect(typeof corrupt.backup).toBe('string');
      expect(existsSync(corrupt.backup)).toBe(true);
    });

    it('loadLock backs up an unparseable lockfile', () => {
      writeFileSync(ctx.paths.lockFile, '!!! not json !!!');
      const lock = loadLock(ctx);
      expect(lock).toBeNull();
      const lines = readFileSync(ctx.paths.auditFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      const corrupt = lines.find((e) => e.event === 'lock_corrupt_detected');
      expect(corrupt).toBeDefined();
      expect(corrupt.reason).toBe('unparseable_json');
    });

    it('loadLock accepts a pre-H-24 lock with no checksum field (back-compat)', () => {
      // Simulate an older binary writing the lock without checksum.
      const legacy: LockFile = {
        phase_id: 1,
        session_id: 'sess-legacy',
        started_at: '2026-05-14T22:00:00Z',
        heartbeat: '2026-05-14T22:00:00Z',
      };
      writeFileSync(ctx.paths.lockFile, JSON.stringify(legacy));
      const lock = loadLock(ctx);
      expect(lock).not.toBeNull();
      expect(lock?.session_id).toBe('sess-legacy');
    });
  });

  // -------------------------------------------------------------------------
  // H-25 — sleep/wake detection
  // -------------------------------------------------------------------------
  describe('H-25 sleep/wake detection', () => {
    it('defers stale-clear when last_wake is fresh but lock heartbeat is old', () => {
      // Set up: lock heartbeat is 2h old (suspended laptop), last_wake fired
      // 30s ago (just resumed and the cron caught up).
      markInProgress(ctx, '1', 'sess-suspended');
      const oldIso = new Date(
        Date.now() - (SLEEP_WAKE_LOCK_AGE_SUSPECT_SEC + 600) * 1000,
      )
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
      const stale: LockFile = {
        phase_id: 1,
        session_id: 'sess-suspended',
        started_at: oldIso,
        heartbeat: oldIso,
      };
      saveLock(ctx, stale);
      recordWake(ctx);
      const r = checkLockStaleness(ctx);
      expect(r.kind).toBe('sleep_wake_deferred');
      // Lock is still there — we did NOT clear.
      expect(loadLock(ctx)).not.toBeNull();
      const lines = readFileSync(ctx.paths.auditFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(
        lines.some((e) => e.event === 'sleep_wake_detected'),
      ).toBe(true);
    });

    it('does NOT defer when last_wake is also stale (wallclock not suspended)', () => {
      markInProgress(ctx, '1', 'sess-truly-stuck');
      const oldIso = new Date(
        Date.now() - (SLEEP_WAKE_LOCK_AGE_SUSPECT_SEC + 600) * 1000,
      )
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
      const stale: LockFile = {
        phase_id: 1,
        session_id: 'sess-truly-stuck',
        started_at: oldIso,
        heartbeat: oldIso,
      };
      saveLock(ctx, stale);
      // last_wake also stale — chain truly stuck, no laptop suspend.
      const state = loadState(ctx);
      state.last_wake = new Date(
        Date.now() - (SLEEP_WAKE_LAST_WAKE_RECENT_SEC + 600) * 1000,
      )
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
      saveState(ctx, state);
      const r = checkLockStaleness(ctx);
      // Should clear normally — not deferred.
      expect(r.kind).toBe('cleared');
    });

    it('does NOT defer when last_wake is null (chain never woken)', () => {
      markInProgress(ctx, '1', 'sess-fresh');
      const oldIso = new Date(
        Date.now() - (SLEEP_WAKE_LOCK_AGE_SUSPECT_SEC + 600) * 1000,
      )
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
      const stale: LockFile = {
        phase_id: 1,
        session_id: 'sess-fresh',
        started_at: oldIso,
        heartbeat: oldIso,
      };
      saveLock(ctx, stale);
      // Don't recordWake — last_wake stays null.
      const r = checkLockStaleness(ctx);
      expect(r.kind).toBe('cleared');
    });
  });
});
