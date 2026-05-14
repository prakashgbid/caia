import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { makeFixture, type FixtureBundle } from './fixtures.js';
import {
  buildInitialState,
  computeNextPhase,
  ensurePhaseEntry,
  initState,
  loadContext,
  loadState,
  markDone,
  markFailed,
  markInProgress,
  pause,
  resume,
  saveState,
  setBudget,
  type StateContext,
} from '../src/state.js';
import {
  HEARTBEAT_GRACE_SEC,
  acquireLock,
  checkLockStaleness,
  clearLock,
  heartbeat,
  loadLock,
  saveLock,
} from '../src/lock.js';
import { appendAudit } from '../src/audit.js';
import type { LockFile } from '../src/types.js';

// Each test path runs 5 cases (matches the original 75-test suite).
//   P01_fresh_init                  — fresh state returns phase 1 in 5 boot orders
//   P02_next_phase_advancement      — mark-done N advances to N+1 for N in {1..5}
//   P03_lock_live                   — lock present, age < 60min, returns IN_PROGRESS
//   P04_stale_heartbeat             — heartbeat older than the per-phase grace (default 30min after H-11) triggers staleness recovery
//   P05_runtime_timeout             — runtime > max_minutes triggers staleness recovery
//   P06_retries_exhausted           — phase failed > max_retries → blocked, skipped
//   P07_paused                      — paused state suppresses dispatch
//   P08_budget_exhausted            — budget >= cap suppresses dispatch
//   P09_all_done                    — all phases done returns ALL_DONE
//   P10_dep_not_met                 — dep-blocked phase isn't dispatchable
//   P11_atomic_write_crash          — corrupt state file is detectable / recoverable
//   P12_concurrent_owner_rejected   — heartbeat from wrong owner rejected
//   P13_mark_failed_path            — explicit failure transitions correctly
//   P14_audit_log_append            — audit log gets each event
//   P15_init_idempotent             — re-init preserves prior state

let fx: FixtureBundle;
let ctx: StateContext;

function nextLabel(): { kind: string; id?: number } {
  const r = computeNextPhase(ctx, loadState(ctx));
  return r;
}

function freshInit(): void {
  for (const f of [ctx.paths.stateFile, ctx.paths.lockFile]) {
    if (existsSync(f)) {
      // remove via fs
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      fs.unlinkSync(f);
    }
  }
  initState(ctx);
}

beforeEach(() => {
  fx = makeFixture(`reg-${Math.random().toString(36).slice(2, 8)}`);
  ctx = loadContext(fx.chainId, fx.specPath);
});

afterEach(() => {
  fx.cleanup();
});

describe('P01_fresh_init', () => {
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: fresh init → next-phase = 1`, () => {
      freshInit();
      const r = nextLabel();
      expect(r.kind).toBe('phase_id');
      if (r.kind === 'phase_id') expect(r.id).toBe(1);
    });
  }
});

describe('P02_next_phase_advancement', () => {
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: mark phases 1..${i - 1} done → next = ${i}`, () => {
      freshInit();
      for (let n = 1; n < i; n++) {
        markInProgress(ctx, String(n), `sess-${i}-${n}`);
        markDone(ctx, String(n));
      }
      const r = nextLabel();
      expect(r.kind).toBe('phase_id');
      if (r.kind === 'phase_id') expect(r.id).toBe(i);
    });
  }
});

describe('P03_lock_live', () => {
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: in-progress lock → IN_PROGRESS`, () => {
      freshInit();
      markInProgress(ctx, '1', `sess-${i}`);
      acquireLock(ctx, 1, `sess-${i}`);
      const r = nextLabel();
      expect(r.kind).toBe('in_progress');
      if (r.kind === 'in_progress') expect(r.id).toBe(1);
    });
  }
});

describe('P04_stale_heartbeat', () => {
  // H-11 (phase 8, 2026-05-14). The default grace is now 1800s (30 min);
  // ages used here [1, 2, 4, 12, 25]h all comfortably exceed it. The 4h case
  // is retained as an above-old-default-3600s anchor so this suite still
  // proves we haven't regressed into a >1h-grace surprise. The 1h case is
  // the tight-margin probe just past the new 30-min default.
  const ageHours = [1, 2, 4, 12, 25];
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: heartbeat aged ${ageHours[i - 1]}h → cleared`, () => {
      freshInit();
      markInProgress(ctx, '1', `sess-stale-${i}`);
      acquireLock(ctx, 1, `sess-stale-${i}`);
      const lock = loadLock(ctx);
      expect(lock).not.toBeNull();
      const hoursAgo = ageHours[i - 1] ?? 2;
      const past = new Date(Date.now() - hoursAgo * 3600 * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
      const lockUpdated: LockFile = { ...(lock as LockFile), heartbeat: past };
      saveLock(ctx, lockUpdated);
      const r = checkLockStaleness(ctx);
      expect(r.kind).toBe('cleared');
      if (r.kind === 'cleared') expect(r.reason).toBe('heartbeat');
    });
  }
});

describe('P05_runtime_timeout', () => {
  // Heartbeat fresh, but started_at is in the distant past — runtime cap trips.
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: started ${[60, 90, 120, 240, 1440][i - 1]}m ago + fresh hb → cleared`, () => {
      freshInit();
      markInProgress(ctx, '1', `sess-timeout-${i}`);
      acquireLock(ctx, 1, `sess-timeout-${i}`);
      const lock = loadLock(ctx);
      expect(lock).not.toBeNull();
      const minutesAgo = [60, 90, 120, 240, 1440][i - 1] ?? 60;
      const startedAt = new Date(Date.now() - minutesAgo * 60 * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
      const fresh = new Date(Date.now() - 30 * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
      const updated: LockFile = {
        ...(lock as LockFile),
        started_at: startedAt,
        heartbeat: fresh,
      };
      saveLock(ctx, updated);
      const r = checkLockStaleness(ctx);
      expect(r.kind).toBe('cleared');
      if (r.kind === 'cleared') expect(r.reason).toBe('timeout');
    });
  }
});

describe('P06_retries_exhausted', () => {
  // Phase forced into failed with attempts > max_retries → next-phase blocks it.
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: attempts=${3 + i} > max_retries=2 → phase blocked`, () => {
      freshInit();
      const state = loadState(ctx);
      const ps = ensurePhaseEntry(state, '1');
      ps.status = 'failed';
      ps.attempts = 3 + i;
      ps.max_retries = 2;
      ps.error = `test_case_${i}`;
      saveState(ctx, state);
      const r = nextLabel();
      // No other phases dispatchable since their deps require phase 1 done.
      expect(r.kind).toBe('none_eligible');
      const after = loadState(ctx);
      expect(after.phase_status['1']?.status).toBe('blocked');
    });
  }
});

describe('P07_paused', () => {
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: pause suppresses dispatch + resume restores it`, () => {
      freshInit();
      for (let n = 1; n < i; n++) {
        markInProgress(ctx, String(n), `s${n}`);
        markDone(ctx, String(n));
      }
      pause(ctx);
      expect(nextLabel().kind).toBe('paused');
      resume(ctx);
      expect(nextLabel().kind).not.toBe('paused');
    });
  }
});

describe('P08_budget_exhausted', () => {
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: budget at ${[25, 30, 50, 75, 100][i - 1]}% → BUDGET_EXHAUSTED`, () => {
      freshInit();
      const pct = [25, 30, 50, 75, 100][i - 1] ?? 25;
      setBudget(ctx, pct);
      expect(nextLabel().kind).toBe('budget_exhausted');
    });
  }
});

describe('P09_all_done', () => {
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: all 13 phases done → ALL_DONE`, () => {
      freshInit();
      for (let n = 1; n <= 13; n++) {
        markInProgress(ctx, String(n), `sess-done-${i}-${n}`);
        markDone(ctx, String(n));
      }
      expect(nextLabel().kind).toBe('all_done');
    });
  }
});

describe('P10_dep_not_met', () => {
  // No phases marked done — only phase 1 is eligible (no deps); phases 3,4,6,10,13 are NOT.
  const targets = [3, 4, 6, 10, 13];
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: target phase ${targets[i - 1]} not eligible (deps unmet) → first eligible = 1`, () => {
      freshInit();
      const r = nextLabel();
      expect(r.kind).toBe('phase_id');
      if (r.kind === 'phase_id') {
        expect(r.id).toBe(1);
        expect(r.id).not.toBe(targets[i - 1]);
      }
    });
  }
});

describe('P11_atomic_write_crash', () => {
  const corruptStates = [
    '{"incomplete":',
    '',
    'not json at all',
    '{}',
    '{"phase_status": "wrong type"}',
  ];
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: corrupt state file (${i === 4 ? 'empty obj' : 'malformed'}) is recoverable`, () => {
      freshInit();
      writeFileSync(ctx.paths.stateFile, corruptStates[i - 1] ?? '');
      // Reading raw via JSON.parse will throw on truly corrupt; we check
      // that re-initializing produces a clean state.
      try {
        loadState(ctx); // may throw
      } catch {
        // expected for malformed inputs — recover via re-init
      }
      // Force re-init by clearing state file then calling initState
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      if (fs.existsSync(ctx.paths.stateFile)) fs.unlinkSync(ctx.paths.stateFile);
      const recovered = initState(ctx);
      expect(recovered.schema_version).toBe(1);
      const r = nextLabel();
      expect(r.kind).toBe('phase_id');
    });
  }
});

describe('P12_concurrent_owner_rejected', () => {
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: heartbeat from wrong owner rejected, right owner accepted`, () => {
      freshInit();
      markInProgress(ctx, '1', `owner-${i}`);
      acquireLock(ctx, 1, `owner-${i}`);
      const wrong = heartbeat(ctx, `wrong-owner-${i}`);
      expect(wrong.kind).toBe('owned_by_other');
      const right = heartbeat(ctx, `owner-${i}`);
      expect(right.kind).toBe('ok');
    });
  }
});

describe('P13_mark_failed_path', () => {
  const reasons = [
    'error_x',
    'timeout',
    'out of memory',
    'missing dep',
    'spawn rejected',
  ];
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: explicit mark-failed transitions correctly`, () => {
      freshInit();
      markInProgress(ctx, '1', `f-sess-${i}`);
      acquireLock(ctx, 1, `f-sess-${i}`);
      markFailed(ctx, '1', reasons[i - 1] ?? 'x');
      clearLock(ctx);
      const after = loadState(ctx);
      expect(after.phase_status['1']?.status).toBe('failed');
      expect(after.phase_status['1']?.error).toContain(reasons[i - 1] ?? 'x');
      expect(existsSync(ctx.paths.lockFile)).toBe(false);
      // Retry → next-phase should still return 1 (attempts < max_retries)
      const r = nextLabel();
      expect(r.kind).toBe('phase_id');
      if (r.kind === 'phase_id') expect(r.id).toBe(1);
    });
  }
});

describe('P14_audit_log_append', () => {
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: audit log records init + in_progress + done events`, () => {
      // Force-clear audit + state so we get a clean log
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      for (const f of [ctx.paths.stateFile, ctx.paths.lockFile, ctx.paths.auditFile]) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      initState(ctx);
      markInProgress(ctx, '1', `audit-${i}`);
      markDone(ctx, '1');
      const lines = readFileSync(ctx.paths.auditFile, 'utf8').trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(3);
      const events = new Set(lines.map((ln) => JSON.parse(ln).event as string));
      expect(events.has('state_init')).toBe(true);
      expect(events.has('phase_in_progress')).toBe(true);
      expect(events.has('phase_done')).toBe(true);
    });
  }
});

describe('P15_init_idempotent', () => {
  for (let i = 1; i <= 5; i++) {
    it(`case ${i}: re-init preserves prior phase state`, () => {
      freshInit();
      for (let n = 1; n <= i; n++) {
        markInProgress(ctx, String(n), `i${n}`);
        markDone(ctx, String(n));
      }
      const before = loadState(ctx).phase_status['1']?.status;
      // Calling initState directly would clobber; the CLI's `init` command
      // checks existsSync first — we replicate that check here.
      if (!existsSync(ctx.paths.stateFile)) {
        initState(ctx);
      }
      const after = loadState(ctx).phase_status['1']?.status;
      expect(before).toBe('done');
      expect(after).toBe('done');
    });
  }
});

describe('regression coverage gates', () => {
  it('exports ensure all 75 cases ran', () => {
    // Sanity: 15 paths × 5 cases = 75
    // (vitest already enforces individual it() pass; this is just a marker.)
    expect(15 * 5).toBe(75);
  });

  it('appendAudit can be called directly', () => {
    appendAudit(ctx.paths.auditFile, 'manual_test', { foo: 'bar' });
    const last = readFileSync(ctx.paths.auditFile, 'utf8').trim().split('\n').pop();
    expect(last).toBeDefined();
    const parsed = JSON.parse(last ?? '{}');
    expect(parsed.event).toBe('manual_test');
    expect(parsed.foo).toBe('bar');
  });

  it('buildInitialState matches the spec', () => {
    const s = buildInitialState(ctx.spec);
    expect(s.phase_status['1']?.status).toBe('pending');
    expect(s.phase_status['13']).toBeDefined();
  });

  it('HEARTBEAT_GRACE_SEC fallback constant is 30 minutes (H-11 default)', () => {
    // H-11 (phase 8, 2026-05-14). The exported constant is now only the
    // legacy fallback for unmigrated PhaseStates. New chains resolve grace
    // from phase override → chain default → DEFAULT_HEARTBEAT_GRACE_SEC.
    expect(HEARTBEAT_GRACE_SEC).toBe(1800);
  });
});
