import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkArtifact,
  classifyStaleLock,
  failureFromReason,
  sniffLogForClass,
} from '../src/classify.js';
import { loadContext, type StateContext } from '../src/state.js';
import { makeFixture, type FixtureBundle } from './fixtures.js';
import type { FailureClass, LockFile } from '../src/types.js';

// Inline fixture-with-success-criteria builder. The classifier's
// worker_hung_post_success branch reads spec.phases[].success_criteria, so a
// dedicated fixture with declared criteria is needed for incident-#1-shaped
// tests.
function makeFixtureWithCriteria(label: string, opts: {
  output_file: string;
  min_bytes: number;
  grep_match?: string;
  auto_resolve?: boolean;
}): { fx: FixtureBundle; ctx: StateContext } {
  const root = mkdtempSync(join(tmpdir(), `caia-cr-classify-${label}-`));
  const chainHome = join(root, 'chain');
  mkdirSync(chainHome, { recursive: true });
  const specPath = join(root, 'phases.yaml');
  const yaml = `defaults:
  max_retries: 2
  max_minutes: 45
  heartbeat_interval_sec: 120

chain_config:
  auto_resolve_hung_post_success: ${opts.auto_resolve ? 'true' : 'false'}

phases:
  - id: 1
    name: classify_phase_one
    deps: []
    max_minutes: 45
    success_criteria:
      output_file: "${opts.output_file}"
      min_bytes: ${opts.min_bytes}${
    opts.grep_match
      ? `\n      grep_match: "${opts.grep_match}"`
      : ''
  }
    prompt_template: |
      classification test phase
  - id: 2
    name: classify_phase_two
    deps: [1]
    prompt_template: |
      downstream
`;
  writeFileSync(specPath, yaml);
  process.env['CAIA_CHAIN_HOME'] = chainHome;
  const chainId = `cr-classify-${label}-${process.pid}`;
  const fx: FixtureBundle = {
    chainHome,
    chainId,
    specPath,
    cleanup: () => {
      delete process.env['CAIA_CHAIN_HOME'];
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
  const ctx = loadContext(chainId, specPath);
  return { fx, ctx };
}

function fakeLock(phaseId = 1): LockFile {
  return {
    phase_id: phaseId,
    session_id: `sess-cls-${phaseId}-${Math.random().toString(36).slice(2, 8)}`,
    started_at: '2026-05-14T00:00:00Z',
    heartbeat: '2026-05-14T00:00:00Z',
  };
}

function writeLog(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

let fx: FixtureBundle;
let ctx: StateContext;
let logDir: string;

beforeEach(() => {
  fx = makeFixture(`cls-${Math.random().toString(36).slice(2, 8)}`);
  ctx = loadContext(fx.chainId, fx.specPath);
  logDir = mkdtempSync(join(tmpdir(), 'caia-cls-logs-'));
});

afterEach(() => {
  fx.cleanup();
  try {
    rmSync(logDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Fixture 01 — F-01: rate-limit banner with reset time
// ---------------------------------------------------------------------------
describe('F01_rate_limit_with_reset_time', () => {
  it('classifies as worker_no_start_rate_limit and parses reset time', () => {
    const log = writeLog(
      logDir,
      'phase1_ratelimit.log',
      "Loading...\nYou've hit your limit · resets May 16 at 12pm (America/New_York)\n",
    );
    const r = classifyStaleLock(ctx, fakeLock(), {
      trigger: 'heartbeat',
      hb_age_sec: 3700,
      dispatchLogPath: log,
    });
    expect(r.class).toBe<FailureClass>('worker_no_start_rate_limit');
    expect(r.reason).toMatch(/resets May 16/i);
    expect(r.evidence['matched_text']).toBeTypeOf('string');
  });
});

// ---------------------------------------------------------------------------
// Fixture 02 — F-01b: rate-limit banner without reset time (curly apostrophe)
// ---------------------------------------------------------------------------
describe('F01b_rate_limit_unicode_apostrophe', () => {
  it('matches the curly-apostrophe variant', () => {
    const log = writeLog(
      logDir,
      'phase1_ratelimit_unicode.log',
      'You’ve hit your limit. Try again later.\n',
    );
    const r = classifyStaleLock(ctx, fakeLock(), {
      trigger: 'heartbeat',
      hb_age_sec: 4000,
      dispatchLogPath: log,
    });
    expect(r.class).toBe<FailureClass>('worker_no_start_rate_limit');
    expect(r.reason).toMatch(/no reset time captured|resets/i);
  });
});

// ---------------------------------------------------------------------------
// Fixture 03 — F-02: auth failure (401)
// ---------------------------------------------------------------------------
describe('F02_auth_failure_401', () => {
  it('classifies as worker_no_start_auth_failure', () => {
    const log = writeLog(
      logDir,
      'phase1_auth.log',
      'API Error 401 Unauthorized: invalid api key\n',
    );
    const r = classifyStaleLock(ctx, fakeLock(), {
      trigger: 'heartbeat',
      hb_age_sec: 3700,
      dispatchLogPath: log,
    });
    expect(r.class).toBe<FailureClass>('worker_no_start_auth_failure');
  });
});

// ---------------------------------------------------------------------------
// Fixture 04 — F-02b: auth failure ("Invalid authentication credentials")
// ---------------------------------------------------------------------------
describe('F02b_invalid_authentication_credentials', () => {
  it('classifies as worker_no_start_auth_failure via the literal string', () => {
    const log = writeLog(
      logDir,
      'phase1_auth2.log',
      'authentication_error: Invalid authentication credentials\n',
    );
    const r = classifyStaleLock(ctx, fakeLock(), {
      trigger: 'heartbeat',
      hb_age_sec: 3700,
      dispatchLogPath: log,
    });
    expect(r.class).toBe<FailureClass>('worker_no_start_auth_failure');
  });
});

// ---------------------------------------------------------------------------
// Fixture 05 — F-03: binary missing (command not found)
// ---------------------------------------------------------------------------
describe('F03_binary_missing_command_not_found', () => {
  it('classifies as worker_no_start_binary_missing', () => {
    const log = writeLog(
      logDir,
      'phase1_no_binary.log',
      '/bin/sh: claude: command not found\n',
    );
    const r = classifyStaleLock(ctx, fakeLock(), {
      trigger: 'heartbeat',
      hb_age_sec: 3700,
      dispatchLogPath: log,
    });
    expect(r.class).toBe<FailureClass>('worker_no_start_binary_missing');
  });
});

// ---------------------------------------------------------------------------
// Fixture 06 — F-04: spawn error (EACCES)
// ---------------------------------------------------------------------------
describe('F04_spawn_error_EACCES', () => {
  it('classifies as worker_no_start_spawn_error', () => {
    const log = writeLog(
      logDir,
      'phase1_eacces.log',
      'spawn claude EACCES: permission denied\n',
    );
    const r = classifyStaleLock(ctx, fakeLock(), {
      trigger: 'heartbeat',
      hb_age_sec: 3700,
      dispatchLogPath: log,
    });
    expect(r.class).toBe<FailureClass>('worker_no_start_spawn_error');
  });
});

// ---------------------------------------------------------------------------
// Fixture 07 — F-05: bad CLI args
// ---------------------------------------------------------------------------
describe('F05_bad_cli_args', () => {
  it('classifies as worker_no_start_bad_args', () => {
    const log = writeLog(
      logDir,
      'phase1_bad_args.log',
      'claude: unknown option `--nonsense`\nusage: claude [...]\n',
    );
    const r = classifyStaleLock(ctx, fakeLock(), {
      trigger: 'heartbeat',
      hb_age_sec: 3700,
      dispatchLogPath: log,
    });
    expect(r.class).toBe<FailureClass>('worker_no_start_bad_args');
  });
});

// ---------------------------------------------------------------------------
// Fixture 08 — F-06: worker hung post-success (artifact validates)
// ---------------------------------------------------------------------------
describe('F06_worker_hung_post_success', () => {
  it('classifies as worker_hung_post_success when artifact exists + meets criteria', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'caia-cls-art-'));
    const artifactPath = join(artifactDir, 'phase1_artifact.md');
    writeFileSync(
      artifactPath,
      '# phase 1 artifact\n' +
        'status: COMPLETE\n' +
        'a'.repeat(2000) +
        '\nCAIA_NODE_BIN: /opt/homebrew/opt/node@22/bin/node\n',
    );
    const built = makeFixtureWithCriteria('hung-post-success', {
      output_file: artifactPath,
      min_bytes: 1500,
      grep_match: 'CAIA_NODE_BIN|healthz',
    });
    try {
      // No log signals — log is empty, but artifact landed.
      const r = classifyStaleLock(built.ctx, fakeLock(), {
        trigger: 'heartbeat',
        hb_age_sec: 4497,
      });
      expect(r.class).toBe<FailureClass>('worker_hung_post_success');
      const art = r.evidence['artifact'] as Record<string, unknown>;
      expect(art.exists).toBe(true);
      expect(art.meets_min_bytes).toBe(true);
      expect(art.grep_matched).toBe(true);
    } finally {
      built.fx.cleanup();
      rmSync(artifactDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture 09 — F-06b: hung post-success rejected when grep_match fails
// ---------------------------------------------------------------------------
describe('F06b_artifact_grep_mismatch_falls_through_to_mid_work', () => {
  it('does NOT classify as hung_post_success when grep does not match', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'caia-cls-art-'));
    const artifactPath = join(artifactDir, 'phase1_artifact.md');
    writeFileSync(artifactPath, 'wrong content ' + 'b'.repeat(3000));
    const built = makeFixtureWithCriteria('grep-mismatch', {
      output_file: artifactPath,
      min_bytes: 1500,
      grep_match: 'CAIA_NODE_BIN|healthz',
    });
    try {
      const r = classifyStaleLock(built.ctx, fakeLock(), {
        trigger: 'heartbeat',
        hb_age_sec: 4497,
      });
      // Falls through to mid-work (heartbeat aged out, no log signal,
      // artifact exists but didn't validate).
      expect(r.class).toBe<FailureClass>('worker_hung_mid_work');
    } finally {
      built.fx.cleanup();
      rmSync(artifactDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture 10 — F-07: worker hung mid-work (no artifact, no log signal)
// ---------------------------------------------------------------------------
describe('F07_worker_hung_mid_work', () => {
  it('classifies as worker_hung_mid_work when heartbeat aged out with no evidence', () => {
    const log = writeLog(logDir, 'phase1_silent.log', 'some unrelated chatter\n');
    const r = classifyStaleLock(ctx, fakeLock(), {
      trigger: 'heartbeat',
      hb_age_sec: 7200,
      dispatchLogPath: log,
    });
    expect(r.class).toBe<FailureClass>('worker_hung_mid_work');
  });
});

// ---------------------------------------------------------------------------
// Fixture 11 — F-08: worker crashed (SIGSEGV / fatal)
// ---------------------------------------------------------------------------
describe('F08_worker_crashed_sigsegv', () => {
  it('classifies as worker_crashed', () => {
    const log = writeLog(
      logDir,
      'phase1_crash.log',
      'Segmentation fault (core dumped)\nFATAL: bus error\n',
    );
    const r = classifyStaleLock(ctx, fakeLock(), {
      trigger: 'heartbeat',
      hb_age_sec: 3700,
      dispatchLogPath: log,
    });
    expect(r.class).toBe<FailureClass>('worker_crashed');
  });
});

// ---------------------------------------------------------------------------
// Fixture 12 — F-14: runtime cap exceeded
// ---------------------------------------------------------------------------
describe('F14_runtime_exceeded', () => {
  it('classifies as runtime_exceeded when trigger=timeout', () => {
    const log = writeLog(logDir, 'phase1_slow.log', 'still working...\n');
    const r = classifyStaleLock(ctx, fakeLock(), {
      trigger: 'timeout',
      run_sec: 5000,
      cap_sec: 2700,
      hb_age_sec: 30,
      dispatchLogPath: log,
    });
    expect(r.class).toBe<FailureClass>('runtime_exceeded');
    expect(r.evidence['cap_sec']).toBe(2700);
  });
});

// ---------------------------------------------------------------------------
// Fixture 13 — F-15: unknown (no log path, no timing evidence)
// ---------------------------------------------------------------------------
describe('F15_unknown_no_evidence', () => {
  it('classifies as unknown when no log + no hb_age + no trigger evidence', () => {
    const r = classifyStaleLock(ctx, fakeLock(), {});
    expect(r.class).toBe<FailureClass>('unknown');
  });
});

// ---------------------------------------------------------------------------
// Fixture 14 — Log precedence: rate-limit wins over auth in mixed log
// ---------------------------------------------------------------------------
describe('LP01_rate_limit_precedes_auth_in_mixed_log', () => {
  it('returns worker_no_start_rate_limit even when log also contains auth string', () => {
    const log = writeLog(
      logDir,
      'phase1_mixed.log',
      "You've hit your limit · resets May 16 at 12pm\n" +
        'Invalid authentication credentials\n',
    );
    const r = classifyStaleLock(ctx, fakeLock(), {
      trigger: 'heartbeat',
      hb_age_sec: 3700,
      dispatchLogPath: log,
    });
    expect(r.class).toBe<FailureClass>('worker_no_start_rate_limit');
  });
});

// ---------------------------------------------------------------------------
// Fixture 15 — Back-compat shim: failureFromReason → unknown
// ---------------------------------------------------------------------------
describe('LP02_failure_from_reason_back_compat_shim', () => {
  it('wraps a string reason as class=unknown with legacy_string_reason evidence', () => {
    const f = failureFromReason('stale_lock heartbeat_age_sec=4497');
    expect(f.class).toBe<FailureClass>('unknown');
    expect(f.reason).toContain('stale_lock');
    expect(f.evidence['legacy_string_reason']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bonus / sanity coverage (not counted toward the 15) — sniff + artifact helpers
// ---------------------------------------------------------------------------
describe('classifier helpers', () => {
  it('sniffLogForClass returns null when path is missing', () => {
    const r = sniffLogForClass(null);
    expect(r.match).toBeNull();
    expect(r.log_sampled).toBe(false);
  });

  it('checkArtifact returns exists=false when output_file absent in success_criteria', () => {
    const built = makeFixtureWithCriteria('noop', {
      output_file: '/tmp/does-not-exist-caia-classify-test.txt',
      min_bytes: 10,
    });
    try {
      const a = checkArtifact(built.ctx, 1);
      expect(a.exists).toBe(false);
    } finally {
      built.fx.cleanup();
    }
  });
});
