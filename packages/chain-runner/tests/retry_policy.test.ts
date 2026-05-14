import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RETRY_POLICY,
  backoffSecForAttempt,
  resolveRetryPolicy,
  validateRetryPolicyEntry,
} from '../src/retry-policy.js';
import {
  computeNextPhase,
  initState,
  loadContext,
  loadState,
  markFailed,
  pause,
  resume,
  saveState,
  type StateContext,
} from '../src/state.js';
import { loadChainSpec } from '../src/spec.js';
import { isoNow } from '../src/time.js';
import type { FailureClass, PhaseFailure } from '../src/types.js';

function makePolicyFixture(label: string, yaml?: string): {
  ctx: StateContext;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), `caia-retry-${label}-`));
  const chainHome = join(root, 'chain');
  mkdirSync(chainHome, { recursive: true });
  const specPath = join(root, 'phases.yaml');
  const defaultYaml = `defaults:
  max_retries: 2
  max_minutes: 45

phases:
  - id: 1
    name: phase_one
    prompt_template: |
      first
  - id: 2
    name: phase_two
    deps: [1]
    prompt_template: |
      second
`;
  writeFileSync(specPath, yaml ?? defaultYaml);
  process.env['CAIA_CHAIN_HOME'] = chainHome;
  const chainId = `cr-retry-${label}-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
  const ctx = loadContext(chainId, specPath);
  initState(ctx);
  return {
    ctx,
    cleanup: () => {
      delete process.env['CAIA_CHAIN_HOME'];
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

function makeFailure(cls: FailureClass): PhaseFailure {
  return {
    class: cls,
    reason: `synthetic ${cls}`,
    detected_at: isoNow(),
    evidence: {},
  };
}

let cleanup: () => void;
beforeEach(() => {
  cleanup = () => undefined;
});
afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Fixture R01 — DEFAULT_RETRY_POLICY exposes one entry per FailureClass
// ---------------------------------------------------------------------------
describe('R01_default_policy_covers_all_classes', () => {
  it('has one default entry per known FailureClass', () => {
    const classes: FailureClass[] = [
      'worker_no_start_rate_limit',
      'worker_no_start_auth_failure',
      'worker_no_start_binary_missing',
      'worker_no_start_spawn_error',
      'worker_no_start_bad_args',
      'worker_hung_post_success',
      'worker_hung_mid_work',
      'worker_crashed',
      'mark_done_failed',
      'artifact_missing',
      'artifact_malformed',
      'pr_unmerged_at_done',
      'acceptance_failed',
      'runtime_exceeded',
      'unknown',
    ];
    for (const c of classes) {
      expect(DEFAULT_RETRY_POLICY[c], `missing default for ${c}`).toBeDefined();
      expect(typeof DEFAULT_RETRY_POLICY[c].max_attempts).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture R02 — rate_limit pauses chain (no retry, action=pause_until_reset)
// ---------------------------------------------------------------------------
describe('R02_rate_limit_blocks_no_retry', () => {
  it('marks phase blocked after a single rate_limit failure (max_attempts=0)', () => {
    const f = makePolicyFixture('ratelimit');
    cleanup = f.cleanup;
    markFailed(f.ctx, '1', makeFailure('worker_no_start_rate_limit'), {
      ranSubstantively: false,
    });
    const s = loadState(f.ctx);
    expect(s.phase_status['1']?.last_failure_class).toBe('worker_no_start_rate_limit');
    const r = computeNextPhase(f.ctx, loadState(f.ctx));
    // Phase 1 is now blocked → no eligible phase since phase 2 deps=[1]
    expect(r.kind).toBe('none_eligible');
    expect(loadState(f.ctx).phase_status['1']?.status).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// Fixture R03 — auth_failure blocks (pause_until_operator)
// ---------------------------------------------------------------------------
describe('R03_auth_failure_blocks_no_retry', () => {
  it('marks phase blocked after a single auth_failure', () => {
    const f = makePolicyFixture('auth');
    cleanup = f.cleanup;
    markFailed(f.ctx, '1', makeFailure('worker_no_start_auth_failure'), {
      ranSubstantively: false,
    });
    const r = computeNextPhase(f.ctx, loadState(f.ctx));
    expect(r.kind).toBe('none_eligible');
    expect(loadState(f.ctx).phase_status['1']?.status).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// Fixture R04 — binary_missing blocks (pause_until_operator)
// ---------------------------------------------------------------------------
describe('R04_binary_missing_blocks_no_retry', () => {
  it('marks phase blocked after a single binary_missing failure', () => {
    const f = makePolicyFixture('binmissing');
    cleanup = f.cleanup;
    markFailed(f.ctx, '1', makeFailure('worker_no_start_binary_missing'), {
      ranSubstantively: false,
    });
    const r = computeNextPhase(f.ctx, loadState(f.ctx));
    expect(r.kind).toBe('none_eligible');
    expect(loadState(f.ctx).phase_status['1']?.status).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// Fixture R05 — spawn_error: retries with backoff 60s,300s,900s; BACKOFF emitted
// ---------------------------------------------------------------------------
describe('R05_spawn_error_retries_with_backoff', () => {
  it('emits BACKOFF for the schedule between retries and stays under max_attempts=3', () => {
    const f = makePolicyFixture('spawnerr');
    cleanup = f.cleanup;
    // First failure: worker_no_start_spawn_error → attempts stays at 0 because
    // markFailed inferRanSubstantivelyFromClass treats worker_no_start_* as false.
    markFailed(f.ctx, '1', makeFailure('worker_no_start_spawn_error'));
    const s1 = loadState(f.ctx);
    expect(s1.phase_status['1']?.attempts).toBe(0);
    // backoff_until should be ~60s in the future
    const bu = s1.phase_status['1']?.backoff_until;
    expect(bu).toBeTruthy();
    if (bu) {
      const delta = (new Date(bu).getTime() - Date.now()) / 1000;
      expect(delta).toBeGreaterThan(50);
      expect(delta).toBeLessThan(70);
    }
    // While in backoff, computeNextPhase returns kind=backoff
    const r = computeNextPhase(f.ctx, loadState(f.ctx));
    expect(r.kind).toBe('backoff');
    if (r.kind === 'backoff') {
      expect(r.seconds).toBeGreaterThan(0);
      expect(r.seconds).toBeLessThanOrEqual(60);
      expect(r.id).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture R06 — backoff window elapsed → next-phase returns phase_id
// ---------------------------------------------------------------------------
describe('R06_backoff_elapses_then_retries', () => {
  it('returns phase_id once backoff_until has passed', () => {
    const f = makePolicyFixture('backoff-elapsed');
    cleanup = f.cleanup;
    markFailed(f.ctx, '1', makeFailure('worker_no_start_spawn_error'));
    // Hand-wind backoff_until into the past
    const s = loadState(f.ctx);
    s.phase_status['1']!.backoff_until = new Date(Date.now() - 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    saveState(f.ctx, s);
    const r = computeNextPhase(f.ctx, loadState(f.ctx));
    expect(r.kind).toBe('phase_id');
    if (r.kind === 'phase_id') expect(r.id).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fixture R07 — hung_post_success: adjudicate action → blocked immediately
// ---------------------------------------------------------------------------
describe('R07_hung_post_success_adjudicate', () => {
  it('promotes to blocked on first failure (action=adjudicate)', () => {
    const f = makePolicyFixture('adjudicate');
    cleanup = f.cleanup;
    markFailed(f.ctx, '1', makeFailure('worker_hung_post_success'), {
      ranSubstantively: true,
    });
    const r = computeNextPhase(f.ctx, loadState(f.ctx));
    expect(r.kind).toBe('none_eligible');
    expect(loadState(f.ctx).phase_status['1']?.status).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// Fixture R08 — worker_crashed: 2 retries with 120s,600s backoff
// ---------------------------------------------------------------------------
describe('R08_worker_crashed_two_retries', () => {
  it('allows two retries before blocking', () => {
    const f = makePolicyFixture('crashed');
    cleanup = f.cleanup;
    // attempt 1: crashed → attempts becomes 1, backoff 120s
    markFailed(f.ctx, '1', makeFailure('worker_crashed'));
    let s = loadState(f.ctx);
    expect(s.phase_status['1']?.attempts).toBe(1);
    // simulate backoff elapsed
    s.phase_status['1']!.backoff_until = new Date(Date.now() - 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    saveState(f.ctx, s);
    let r = computeNextPhase(f.ctx, loadState(f.ctx));
    expect(r.kind).toBe('phase_id');
    // attempt 2: crashed again → attempts becomes 2, backoff 600s
    markFailed(f.ctx, '1', makeFailure('worker_crashed'));
    s = loadState(f.ctx);
    expect(s.phase_status['1']?.attempts).toBe(2);
    s.phase_status['1']!.backoff_until = new Date(Date.now() - 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    saveState(f.ctx, s);
    // attempt 3 (next-phase): attempts >= max_attempts(2) → blocked
    r = computeNextPhase(f.ctx, loadState(f.ctx));
    expect(r.kind).toBe('none_eligible');
    expect(loadState(f.ctx).phase_status['1']?.status).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// Fixture R09 — runtime_exceeded action=alert → blocked
// ---------------------------------------------------------------------------
describe('R09_runtime_exceeded_alert', () => {
  it('blocks on runtime_exceeded (action=alert, max_attempts=0)', () => {
    const f = makePolicyFixture('runtime');
    cleanup = f.cleanup;
    markFailed(f.ctx, '1', makeFailure('runtime_exceeded'));
    const r = computeNextPhase(f.ctx, loadState(f.ctx));
    expect(r.kind).toBe('none_eligible');
    expect(loadState(f.ctx).phase_status['1']?.status).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// Fixture R10 — YAML override: chain-level retry_policy beats defaults
// ---------------------------------------------------------------------------
describe('R10_yaml_override', () => {
  it('honors defaults.retry_policy.<class> override', () => {
    const yaml = `defaults:
  max_retries: 2
  retry_policy:
    worker_no_start_rate_limit:
      max_attempts: 5
      backoff_sec: [10, 20, 30, 40, 50]
      action: retry
phases:
  - id: 1
    name: phase_one
    prompt_template: |
      first
`;
    const f = makePolicyFixture('yaml-override', yaml);
    cleanup = f.cleanup;
    // Resolve should use the override, not the default 0-attempts policy
    const resolved = resolveRetryPolicy(f.ctx.spec, 'worker_no_start_rate_limit');
    expect(resolved.max_attempts).toBe(5);
    expect(resolved.backoff_sec).toEqual([10, 20, 30, 40, 50]);
    expect(resolved.action).toBe('retry');
  });
});

// ---------------------------------------------------------------------------
// Fixture R11 — spec validation rejects unknown class
// ---------------------------------------------------------------------------
describe('R11_spec_validation_unknown_class', () => {
  it('throws when retry_policy contains an unknown FailureClass key', () => {
    const root = mkdtempSync(join(tmpdir(), 'caia-spec-bad-'));
    const specPath = join(root, 'phases.yaml');
    writeFileSync(
      specPath,
      `defaults:
  retry_policy:
    not_a_real_class:
      max_attempts: 1
phases:
  - id: 1
    name: x
    prompt_template: |
      x
`,
    );
    try {
      expect(() => loadChainSpec(specPath)).toThrow(/unknown FailureClass/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture R12 — spec validation rejects malformed entry (max_attempts type)
// ---------------------------------------------------------------------------
describe('R12_spec_validation_bad_entry', () => {
  it('throws when max_attempts is not a non-negative integer', () => {
    expect(() =>
      validateRetryPolicyEntry('worker_crashed', {
        max_attempts: -1,
      }),
    ).toThrow(/max_attempts/);
    expect(() =>
      validateRetryPolicyEntry('worker_crashed', {
        max_attempts: 'three',
      }),
    ).toThrow(/max_attempts/);
  });
});

// ---------------------------------------------------------------------------
// Fixture R13 — backoffSecForAttempt indexing
// ---------------------------------------------------------------------------
describe('R13_backoff_indexing', () => {
  it('returns the right backoff for each retry index', () => {
    const policy = { max_attempts: 3, backoff_sec: [60, 300, 900] };
    expect(backoffSecForAttempt(policy, 0)).toBe(60);
    expect(backoffSecForAttempt(policy, 1)).toBe(300);
    expect(backoffSecForAttempt(policy, 2)).toBe(900);
    expect(backoffSecForAttempt(policy, 3)).toBeNull();
    expect(backoffSecForAttempt({ max_attempts: 0 }, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fixture R14 — paused chain + paused_until persisted
// ---------------------------------------------------------------------------
describe('R14_pause_with_until', () => {
  it('persists paused_until + paused_reason; resume clears them', () => {
    const f = makePolicyFixture('pause-until');
    cleanup = f.cleanup;
    pause(f.ctx, {
      reason: 'rate_limit_until_2026-05-16T16:00:00Z',
      pausedUntil: '2026-05-16T16:00:00Z',
    });
    let s = loadState(f.ctx);
    expect(s.paused).toBe(true);
    expect(s.paused_until).toBe('2026-05-16T16:00:00Z');
    expect(s.paused_reason).toMatch(/rate_limit_until/);
    // computeNextPhase short-circuits on paused.
    const r = computeNextPhase(f.ctx, s);
    expect(r.kind).toBe('paused');
    // Resume clears.
    resume(f.ctx);
    s = loadState(f.ctx);
    expect(s.paused).toBe(false);
    expect(s.paused_until).toBeNull();
    expect(s.paused_reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fixture R15 — markFailed records last_failure_class in PhaseState
// ---------------------------------------------------------------------------
describe('R15_marks_last_failure_class', () => {
  it('persists last_failure_class on every typed markFailed', () => {
    const f = makePolicyFixture('lastclass');
    cleanup = f.cleanup;
    markFailed(f.ctx, '1', makeFailure('worker_hung_mid_work'));
    expect(loadState(f.ctx).phase_status['1']?.last_failure_class).toBe(
      'worker_hung_mid_work',
    );
  });
});

// ---------------------------------------------------------------------------
// Fixture R16 — legacy string-reason markFailed preserves old retry contract
// ---------------------------------------------------------------------------
describe('R16_legacy_string_reason_back_compat', () => {
  it('uses ps.max_retries (not class policy) when failure came in via string-reason shim', () => {
    const f = makePolicyFixture('legacy');
    cleanup = f.cleanup;
    // Legacy callers pass a free-form string → class=unknown +
    // evidence.legacy_string_reason=true → state.markFailed falls back to
    // ps.max_retries=2 to keep the pre-H-9 regression suite green.
    markFailed(f.ctx, '1', 'legacy_failure_reason');
    const ps = loadState(f.ctx).phase_status['1'];
    expect(ps?.attempts).toBe(1);
    // attempts(1) < max_retries(2) → still retryable, no backoff
    const r = computeNextPhase(f.ctx, loadState(f.ctx));
    expect(r.kind).toBe('phase_id');
    expect(ps?.backoff_until).toBeNull();
  });
});
