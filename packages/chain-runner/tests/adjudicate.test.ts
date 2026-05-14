import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixture, type FixtureBundle } from './fixtures.js';
import {
  adjudicate,
  computeNextPhase,
  evaluateNextPhase,
  forceFail,
  initState,
  loadContext,
  loadState,
  markFailed,
  markInProgress,
  promoteFailedToBlocked,
  reArm,
  type StateContext,
} from '../src/state.js';
import type { AuditEvent } from '../src/types.js';

// H-8 / H-21 (chain-runner-battle-harden phase 7, 2026-05-14).
//
// Verbs under test:
//   - adjudicate(ctx, phaseId, toState, reason, opts)
//   - reArm(ctx, phaseId, reason, opts)
//   - forceFail(ctx, phaseId, reason)
//   - promoteFailedToBlocked(ctx, state)
//   - evaluateNextPhase(state, spec) — pure
//
// Coverage:
//   A01 adjudicate done — round-trip + audit shape + backup written
//   A02 adjudicate pending — clears error/failure/backoff
//   A03 adjudicate blocked — keeps error, fires audit
//   A04 adjudicate validates target state (rejects bogus)
//   A05 adjudicate requires non-empty reason
//   A06 adjudicate strict --to done refuses without evidence
//   A07 adjudicate strict --to done accepts with pr evidence
//   A08 reArm from blocked → pending (no resetAttempts)
//   A09 reArm with resetAttempts zeros ps.attempts
//   A10 reArm refuses non-blocked without force
//   A11 reArm with force from failed works
//   A12 reArm requires non-empty reason
//   A13 forceFail any state → failed, class=unknown, source=operator_force_fail
//   A14 forceFail requires non-empty reason
//   A15 backups land under .backups/ with isoNow suffix
//   A16 evaluateNextPhase is pure (no state mutation, no audit emit)
//   A17 promoteFailedToBlocked walks failed phases and promotes when retries exhausted
//   A18 computeNextPhase post-H21 still matches pre-H21 contract for happy path
//   A19 incident-replay: phase 3 blocked → adjudicate done with pr evidence (the
//       2026-05-14T07:13:59Z hand-edit pattern, replaced with a sanctioned verb)

let fx: FixtureBundle;
let ctx: StateContext;

function readAuditEvents(): AuditEvent[] {
  if (!existsSync(ctx.paths.auditFile)) return [];
  const raw = readFileSync(ctx.paths.auditFile, 'utf8').trimEnd();
  if (raw.length === 0) return [];
  return raw.split('\n').map((line) => JSON.parse(line) as AuditEvent);
}

function lastAuditOfType(event: string): AuditEvent | undefined {
  const events = readAuditEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.event === event) return events[i];
  }
  return undefined;
}

function listBackups(): string[] {
  const dir = join(ctx.paths.baseDir, '.backups');
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

beforeEach(() => {
  fx = makeFixture(`adjudicate-${Math.random().toString(36).slice(2, 8)}`);
  ctx = loadContext(fx.chainId, fx.specPath);
  initState(ctx);
  // Disable the handoff refresh hook — test harness should not spawn shells.
  process.env['CAIA_DISABLE_HANDOFF_REFRESH'] = '1';
});

afterEach(() => {
  delete process.env['CAIA_DISABLE_HANDOFF_REFRESH'];
  fx.cleanup();
});

describe('A01_adjudicate_to_done', () => {
  it('round-trips to done + writes audit + writes backup', () => {
    markInProgress(ctx, '1', 'sess-1');
    const r = adjudicate(ctx, '1', 'done', 'PR #434 merged; worker hung; verified manually', {
      evidence: { pr: 'https://github.com/prakashgbid/caia/pull/434' },
    });
    expect(r.from).toBe('in_progress');
    expect(r.to).toBe('done');
    expect(existsSync(r.backup)).toBe(true);

    const state = loadState(ctx);
    expect(state.phase_status['1']?.status).toBe('done');
    expect(state.phase_status['1']?.completed_at).toBeTruthy();
    expect(state.current_phase).toBeNull();

    const ev = lastAuditOfType('phase_adjudicated');
    expect(ev).toBeDefined();
    expect(ev?.['phase_id']).toBe(1);
    expect(ev?.['from']).toBe('in_progress');
    expect(ev?.['to']).toBe('done');
    expect(ev?.['reason']).toContain('PR #434');
    expect((ev?.['evidence'] as Record<string, unknown>)['pr']).toBe(
      'https://github.com/prakashgbid/caia/pull/434',
    );
    expect(ev?.['backup']).toBeTruthy();
  });
});

describe('A02_adjudicate_to_pending_clears_failure_fields', () => {
  it('clears error/failure/backoff/session/started/completed', () => {
    markInProgress(ctx, '1', 'sess-1');
    markFailed(ctx, '1', {
      class: 'worker_crashed',
      reason: 'segfault',
      detected_at: new Date().toISOString(),
      evidence: {},
    });
    adjudicate(ctx, '1', 'pending', 'manual retry after segfault investigation');
    const ps = loadState(ctx).phase_status['1']!;
    expect(ps.status).toBe('pending');
    expect(ps.error).toBeNull();
    expect(ps.failure).toBeNull();
    expect(ps.last_failure_class).toBeNull();
    expect(ps.backoff_until).toBeNull();
    expect(ps.session_id).toBeNull();
    expect(ps.started_at).toBeNull();
    expect(ps.completed_at).toBeNull();
  });
});

describe('A03_adjudicate_to_blocked', () => {
  it('flips to blocked + records reason as error if blank', () => {
    adjudicate(ctx, '2', 'blocked', 'deps changed upstream — needs rework');
    const ps = loadState(ctx).phase_status['2']!;
    expect(ps.status).toBe('blocked');
    expect(ps.error).toContain('deps changed upstream');
  });
});

describe('A04_adjudicate_validates_target', () => {
  it('rejects an invalid target state', () => {
    expect(() => adjudicate(ctx, '1', 'banana' as never, 'no')).toThrow(
      /invalid target state/,
    );
  });
});

describe('A05_adjudicate_requires_reason', () => {
  it('rejects empty reason', () => {
    expect(() => adjudicate(ctx, '1', 'done', '')).toThrow(/reason is required/);
    expect(() => adjudicate(ctx, '1', 'done', '   ')).toThrow(/reason is required/);
  });
});

describe('A06_adjudicate_strict_done_refuses_without_evidence', () => {
  it('strict to done with no pr/artifact/verification throws', () => {
    expect(() =>
      adjudicate(ctx, '1', 'done', 'ok', { strict: true, evidence: {} }),
    ).toThrow(/strict adjudicate --to done refused/);
  });
});

describe('A07_adjudicate_strict_done_accepts_with_pr', () => {
  it('strict to done with pr= evidence succeeds', () => {
    expect(() =>
      adjudicate(ctx, '1', 'done', 'verified merged', {
        strict: true,
        evidence: { pr: 'https://github.com/x/y/pull/1' },
      }),
    ).not.toThrow();
    expect(loadState(ctx).phase_status['1']?.status).toBe('done');
  });
});

describe('A08_reArm_from_blocked', () => {
  it('flips blocked → pending and emits phase_rearmed', () => {
    // Drive phase 1 to blocked via markFailed past max_retries
    markInProgress(ctx, '1', 's');
    markFailed(ctx, '1', 'first');
    markFailed(ctx, '1', 'second');
    markFailed(ctx, '1', 'third');
    // computeNextPhase will promote it
    let state = loadState(ctx);
    computeNextPhase(ctx, state);
    state = loadState(ctx);
    expect(state.phase_status['1']?.status).toBe('blocked');

    const r = reArm(ctx, '1', 'operator: third failure was transient');
    expect(r.from).toBe('blocked');
    expect(r.attemptsBefore).toBeGreaterThan(0);
    expect(r.attemptsAfter).toBe(r.attemptsBefore);

    const ps = loadState(ctx).phase_status['1']!;
    expect(ps.status).toBe('pending');
    expect(ps.error).toBeNull();
    expect(ps.backoff_until).toBeNull();
    const ev = lastAuditOfType('phase_rearmed');
    expect(ev?.['phase_id']).toBe(1);
    expect(ev?.['reset_attempts']).toBe(false);
    expect(ev?.['backup']).toBeTruthy();
  });
});

describe('A09_reArm_with_resetAttempts', () => {
  it('zeros ps.attempts when resetAttempts=true', () => {
    markInProgress(ctx, '1', 's');
    markFailed(ctx, '1', 'one');
    markFailed(ctx, '1', 'two');
    markFailed(ctx, '1', 'three');
    computeNextPhase(ctx, loadState(ctx));
    const r = reArm(ctx, '1', 'reset retry counter for clean slate', {
      resetAttempts: true,
    });
    expect(r.attemptsAfter).toBe(0);
    expect(loadState(ctx).phase_status['1']?.attempts).toBe(0);
  });
});

describe('A10_reArm_refuses_non_blocked', () => {
  it('refuses to re-arm from in_progress without force', () => {
    markInProgress(ctx, '1', 's');
    expect(() => reArm(ctx, '1', 'try anyway')).toThrow(/re-arm refused/);
  });
});

describe('A11_reArm_with_force', () => {
  it('--force lifts the blocked-only guard', () => {
    markInProgress(ctx, '1', 's');
    markFailed(ctx, '1', 'transient');
    expect(() =>
      reArm(ctx, '1', 'forcing a re-arm from failed', { force: true }),
    ).not.toThrow();
    expect(loadState(ctx).phase_status['1']?.status).toBe('pending');
  });
});

describe('A12_reArm_requires_reason', () => {
  it('rejects empty reason', () => {
    expect(() => reArm(ctx, '1', '')).toThrow(/reason is required/);
  });
});

describe('A13_forceFail_flips_to_failed_with_unknown_class', () => {
  it('any state → failed with source=operator_force_fail', () => {
    const r = forceFail(ctx, '2', 'operator override: phase outputs invalidated');
    expect(r.from).toBe('pending');
    const ps = loadState(ctx).phase_status['2']!;
    expect(ps.status).toBe('failed');
    expect(ps.last_failure_class).toBe('unknown');
    expect(ps.failure?.evidence?.['source']).toBe('operator_force_fail');
    const ev = lastAuditOfType('phase_force_failed');
    expect(ev?.['phase_id']).toBe(2);
    expect(ev?.['from']).toBe('pending');
  });
});

describe('A14_forceFail_requires_reason', () => {
  it('rejects empty reason', () => {
    expect(() => forceFail(ctx, '1', '')).toThrow(/reason is required/);
  });
});

describe('A15_backup_path_shape', () => {
  it('backup files live under .backups/ with the right prefix', () => {
    adjudicate(ctx, '1', 'done', 'manual close', {
      evidence: { pr: 'https://x/pull/1' },
    });
    const backups = listBackups();
    expect(backups.length).toBe(1);
    expect(backups[0]).toMatch(
      /^state\.json\.bak\.pre-adjudicate-1-to-done\.\d{4}-\d{2}-\d{2}T/,
    );
  });
});

describe('A16_evaluateNextPhase_is_pure', () => {
  it('does not mutate state.json, does not append to audit, and matches computeNextPhase for the happy path', () => {
    const beforeAuditExists = existsSync(ctx.paths.auditFile);
    const beforeAuditSize = beforeAuditExists
      ? readFileSync(ctx.paths.auditFile, 'utf8').length
      : 0;
    const beforeState = readFileSync(ctx.paths.stateFile, 'utf8');

    const state = loadState(ctx);
    const r1 = evaluateNextPhase(state, ctx.spec);
    const r2 = evaluateNextPhase(state, ctx.spec);
    expect(r1).toEqual(r2);
    expect(r1.kind).toBe('phase_id');
    if (r1.kind === 'phase_id') expect(r1.id).toBe(1);

    // No state.json write, no audit append.
    expect(readFileSync(ctx.paths.stateFile, 'utf8')).toBe(beforeState);
    const afterAuditSize = existsSync(ctx.paths.auditFile)
      ? readFileSync(ctx.paths.auditFile, 'utf8').length
      : 0;
    expect(afterAuditSize).toBe(beforeAuditSize);
  });

  it('skips a "would-be-promoted" failed phase (returns next eligible)', () => {
    // Fail phase 1 past max_retries — without calling promoteFailedToBlocked,
    // evaluateNextPhase should still treat it as "not dispatchable" (returning
    // none_eligible if no other phase is eligible).
    markInProgress(ctx, '1', 's');
    markFailed(ctx, '1', 'a');
    markFailed(ctx, '1', 'b');
    markFailed(ctx, '1', 'c');
    const state = loadState(ctx);
    // Phase 1 is still 'failed' in state — promoteFailedToBlocked hasn't run.
    expect(state.phase_status['1']?.status).toBe('failed');
    const r = evaluateNextPhase(state, ctx.spec);
    // Phase 2 depends on 1, so it should not be dispatchable; result should be
    // none_eligible (the H-21 read-only contract: failed-to-be-blocked is
    // skipped without mutation).
    expect(r.kind).toBe('none_eligible');
    // And state.phase_status[1].status is still 'failed' — no side effect.
    const after = loadState(ctx);
    expect(after.phase_status['1']?.status).toBe('failed');
  });
});

describe('A17_promoteFailedToBlocked', () => {
  it('walks failed phases and promotes when retries exhausted', () => {
    markInProgress(ctx, '1', 's');
    markFailed(ctx, '1', 'a');
    markFailed(ctx, '1', 'b');
    markFailed(ctx, '1', 'c');
    const state = loadState(ctx);
    const promoted = promoteFailedToBlocked(ctx, state);
    expect(promoted).toContain(1);
    const reloaded = loadState(ctx);
    expect(reloaded.phase_status['1']?.status).toBe('blocked');
    const evs = readAuditEvents();
    const lastBlocked = evs.reverse().find((e) => e.event === 'phase_blocked');
    expect(lastBlocked?.['phase_id']).toBe(1);
    expect(lastBlocked?.['reason']).toBe('retries_exhausted');
  });

  it('is a no-op when no failed phases', () => {
    const state = loadState(ctx);
    const promoted = promoteFailedToBlocked(ctx, state);
    expect(promoted).toEqual([]);
  });
});

describe('A18_computeNextPhase_back_compat', () => {
  it('happy path matches pre-H21 contract: returns phase_id=1 from a fresh init', () => {
    const r = computeNextPhase(ctx, loadState(ctx));
    expect(r.kind).toBe('phase_id');
    if (r.kind === 'phase_id') expect(r.id).toBe(1);
  });

  it('failed-past-retries still ends in blocked via the combined call', () => {
    markInProgress(ctx, '1', 's');
    markFailed(ctx, '1', 'a');
    markFailed(ctx, '1', 'b');
    markFailed(ctx, '1', 'c');
    computeNextPhase(ctx, loadState(ctx));
    expect(loadState(ctx).phase_status['1']?.status).toBe('blocked');
  });
});

describe('A19_incident_replay_phase3_blocked_to_done', () => {
  it('mirrors the 2026-05-14T07:13:59Z phase-3 hand-edit as a sanctioned adjudicate', () => {
    // Drive phase 1 + 2 to done so phase 3 is eligible.
    markInProgress(ctx, '1', 's1');
    // Force phase 1 done via adjudicate so we don't need real lifecycle.
    adjudicate(ctx, '1', 'done', 'fast-forward for test setup', {
      evidence: { test: 'setup' },
    });
    adjudicate(ctx, '2', 'done', 'fast-forward for test setup', {
      evidence: { test: 'setup' },
    });
    // Phase 3 starts in_progress, gets stuck, lock goes stale, retries exhaust → blocked.
    markInProgress(ctx, '3', 'phase3-session');
    markFailed(ctx, '3', 'stale_lock heartbeat_age_sec=4497');
    markFailed(ctx, '3', 'stale_lock heartbeat_age_sec=4497');
    markFailed(ctx, '3', 'stale_lock heartbeat_age_sec=4497');
    computeNextPhase(ctx, loadState(ctx));
    expect(loadState(ctx).phase_status['3']?.status).toBe('blocked');

    // The sanctioned recovery: a single adjudicate verb.
    const r = adjudicate(
      ctx,
      '3',
      'done',
      'PR #434 merged; worker hung post-success; verified manually',
      {
        evidence: {
          pr: 'https://github.com/prakashgbid/caia/pull/434',
          incident: '2026-05-14T07:13:59Z',
        },
      },
    );
    expect(r.from).toBe('blocked');
    expect(r.to).toBe('done');
    const ps = loadState(ctx).phase_status['3']!;
    expect(ps.status).toBe('done');
    expect(ps.completed_at).toBeTruthy();
    // Audit shape is phase_adjudicated (NOT a hand-typed phase_done note).
    const ev = lastAuditOfType('phase_adjudicated');
    expect(ev?.['from']).toBe('blocked');
    expect(ev?.['to']).toBe('done');
    expect((ev?.['evidence'] as Record<string, unknown>)['pr']).toContain('pull/434');
    expect((ev?.['evidence'] as Record<string, unknown>)['incident']).toBe(
      '2026-05-14T07:13:59Z',
    );
    expect(ev?.['backup']).toBeTruthy();
    // Backup file exists on disk.
    expect(existsSync(String(ev?.['backup']))).toBe(true);
  });
});
