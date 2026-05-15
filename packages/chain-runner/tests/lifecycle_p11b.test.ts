import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { makeFixture, type FixtureBundle } from './fixtures.js';
import {
  initState,
  loadContext,
  loadState,
  markInProgress,
  type StateContext,
} from '../src/state.js';
import {
  acquireLock,
  clearLock,
  loadLock,
  saveLock,
  stampWorkerPid,
} from '../src/lock.js';
import type { LockFile } from '../src/types.js';

// H-30 / H-42 cluster B tests — lifecycle hardening (chain-runner-battle-harden
// phase 11, 2026-05-14). H-31 (wake-script robustness) and H-41 (watchdog log
// streams) are bash/launchd surfaces validated by reading the deployed file
// state, not unit tests.

describe('cluster B — lifecycle hardening', () => {
  let bundle: FixtureBundle;
  let ctx: StateContext;

  beforeEach(() => {
    bundle = makeFixture('p11b-lifecycle');
    ctx = loadContext(bundle.chainId, bundle.specPath);
    initState(ctx);
  });

  afterEach(() => {
    bundle.cleanup();
  });

  // -------------------------------------------------------------------------
  // H-30 — prompt-file cleanup
  // -------------------------------------------------------------------------
  describe('H-30 prompt-file cleanup', () => {
    it('clearLock removes the prompt-file tmpdir when prompt_file is recorded', () => {
      // Synthesize a prompt-file in the canonical caia_chain_phase_<id>_*
      // tmpdir layout that buildPromptFile uses.
      const dir = mkdtempSync(join(tmpdir(), 'caia_chain_phase_1_'));
      const promptFile = join(dir, 'phase_1.txt');
      writeFileSync(promptFile, 'PHASE 1 BODY');
      acquireLock(ctx, 1, 'sess-cleanup', { promptFile });
      // Confirm the dir exists.
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(promptFile)).toBe(true);
      clearLock(ctx);
      // Both file and parent dir should be gone.
      expect(existsSync(promptFile)).toBe(false);
      expect(existsSync(dir)).toBe(false);
      const lines = readFileSync(ctx.paths.auditFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      const cleaned = lines.find((e) => e.event === 'prompt_dir_cleaned');
      expect(cleaned).toBeDefined();
      expect(cleaned.parent).toBe(dir);
    });

    it('clearLock skips cleanup when prompt_file is absent (back-compat)', () => {
      acquireLock(ctx, 1, 'sess-no-prompt');
      // Lock has no prompt_file — clearLock should still work, not crash.
      expect(() => clearLock(ctx)).not.toThrow();
      expect(loadLock(ctx)).toBeNull();
    });

    it('clearLock refuses to delete a path that lacks the caia_chain_phase_ prefix', () => {
      // Defensive guard: a stray prompt_file pointing to /etc shouldn't blow
      // up the user's filesystem.
      const safeDir = mkdtempSync(join(tmpdir(), 'unrelated-dir-'));
      const promptFile = join(safeDir, 'malicious.txt');
      writeFileSync(promptFile, 'should NOT be deleted');
      acquireLock(ctx, 1, 'sess-defensive', { promptFile });
      clearLock(ctx);
      // The unrelated dir is left intact.
      expect(existsSync(safeDir)).toBe(true);
      expect(existsSync(promptFile)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // H-42 — graceful stop / lock worker_pid stamping
  // -------------------------------------------------------------------------
  describe('H-42 worker_pid lifecycle on lock', () => {
    it('acquireLock stamps worker_pid when supplied', () => {
      acquireLock(ctx, 1, 'sess-pid', { workerPid: 12345 });
      const lock = loadLock(ctx);
      expect(lock?.worker_pid).toBe(12345);
    });

    it('stampWorkerPid updates an existing lock', () => {
      acquireLock(ctx, 1, 'sess-stamp');
      stampWorkerPid(ctx, 'sess-stamp', 99887);
      const lock = loadLock(ctx);
      expect(lock?.worker_pid).toBe(99887);
    });

    it('stampWorkerPid refuses on session_id mismatch (no-op)', () => {
      acquireLock(ctx, 1, 'sess-owner');
      stampWorkerPid(ctx, 'sess-stranger', 11111);
      const lock = loadLock(ctx);
      // worker_pid should NOT have been overwritten.
      expect(lock?.worker_pid).toBeUndefined();
    });

    it('stampWorkerPid is a no-op when no lock exists', () => {
      // No lock present — should not throw.
      expect(() => stampWorkerPid(ctx, 'sess-anyone', 999)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // H-42 — `caia-chain stop` end-to-end (CLI subprocess)
  // -------------------------------------------------------------------------
  describe('H-42 caia-chain stop CLI', () => {
    it('marks phase failed (source=operator_stop) and clears lock', async () => {
      // Spawn a long-running sleep — its PID becomes the worker_pid.
      const child = spawn('sleep', ['30']);
      const pid = child.pid;
      expect(pid).toBeDefined();
      markInProgress(ctx, '1', 'sess-stoptest');
      acquireLock(ctx, 1, 'sess-stoptest', { workerPid: pid });

      const cliBin = join(
        process.cwd(),
        'bin',
        'caia-chain.js',
      );
      const stopArgs = [
        cliBin,
        'stop',
        '--chain-id', bundle.chainId,
        '--phases', bundle.specPath,
        '--phase', '1',
        '--grace-ms', '1000',
        '--reason', 'unit-test stop',
      ];
      const stop = spawn(process.execPath, stopArgs, {
        env: process.env,
      });
      let stdout = '';
      stop.stdout.on('data', (d) => {
        stdout += d.toString('utf8');
      });
      const stopExit = await new Promise<number>((resolve) => {
        stop.on('exit', (code) => resolve(code ?? -1));
      });
      expect(stopExit).toBe(0);
      expect(stdout).toContain('OPERATOR_STOP phase=1');

      // Lock should be cleared.
      expect(loadLock(ctx)).toBeNull();
      // Phase status: failed, with operator_stop evidence.
      const state = loadState(ctx);
      expect(state.phase_status['1']?.status).toBe('failed');
      expect(state.phase_status['1']?.failure?.evidence?.['source']).toBe(
        'operator_stop',
      );
      // The sleep child should be dead.
      try {
        process.kill(pid as number, 0);
        // If we got here the child is alive — kill it for cleanup but fail.
        process.kill(pid as number, 'SIGKILL');
        throw new Error('worker should be dead after operator_stop');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        expect(code).toBe('ESRCH');
      }

      const lines = readFileSync(ctx.paths.auditFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(
        lines.some((e) => e.event === 'operator_stop_signaled'),
      ).toBe(true);
      expect(lines.some((e) => e.event === 'phase_failed')).toBe(true);
    }, 15_000);

    it('exits 0 with NO_LOCK when no lock exists', async () => {
      const cliBin = join(process.cwd(), 'bin', 'caia-chain.js');
      const stop = spawn(process.execPath, [
        cliBin,
        'stop',
        '--chain-id', bundle.chainId,
        '--phases', bundle.specPath,
      ]);
      let stdout = '';
      stop.stdout.on('data', (d) => {
        stdout += d.toString('utf8');
      });
      const exit = await new Promise<number>((resolve) => {
        stop.on('exit', (code) => resolve(code ?? -1));
      });
      expect(exit).toBe(0);
      expect(stdout).toContain('NO_LOCK');
    }, 10_000);

    it('refuses (exit 2) on phase mismatch', async () => {
      acquireLock(ctx, 2, 'sess-mismatch', { workerPid: process.pid });
      const cliBin = join(process.cwd(), 'bin', 'caia-chain.js');
      const stop = spawn(process.execPath, [
        cliBin,
        'stop',
        '--chain-id', bundle.chainId,
        '--phases', bundle.specPath,
        '--phase', '5', // wrong
      ]);
      let stderr = '';
      stop.stderr.on('data', (d) => {
        stderr += d.toString('utf8');
      });
      const exit = await new Promise<number>((resolve) => {
        stop.on('exit', (code) => resolve(code ?? -1));
      });
      expect(exit).toBe(2);
      expect(stderr).toContain('STOP_REFUSED');
      // Lock untouched
      expect(loadLock(ctx)?.phase_id).toBe(2);
    }, 10_000);
  });

  // Helper-test: saveLock + loadLock round-trip preserves prompt_file +
  // worker_pid (back-compat smoke).
  it('saveLock/loadLock round-trip preserves prompt_file + worker_pid', () => {
    const lock: LockFile = {
      phase_id: 3,
      session_id: 'sess-roundtrip',
      started_at: '2026-05-14T22:00:00Z',
      heartbeat: '2026-05-14T22:01:00Z',
      prompt_file: '/tmp/caia_chain_phase_3_xxx/phase_3.txt',
      worker_pid: 4242,
    };
    saveLock(ctx, lock);
    const back = loadLock(ctx);
    expect(back?.prompt_file).toBe(lock.prompt_file);
    expect(back?.worker_pid).toBe(4242);
  });
});
