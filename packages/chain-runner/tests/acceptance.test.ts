// H-15 (phase 9, 2026-05-14). Tests for src/acceptance.ts +
// state.markDone integration.
//
// Coverage:
//   - resolveEnforceMode: phase override > chain default > 'warn'
//   - output_file existence, min_bytes, grep_match all pass
//   - any criterion fails → result.ok=false, summary names the failure
//   - requires_merged_pr with no PR refs → ok (matches gate-mark-done)
//   - requires_merged_pr with OPEN PR → fail
//   - requires_merged_pr with MERGED PR → ok
//   - state.markDone in warn mode emits phase_acceptance_warn audit + proceeds
//   - state.markDone in strict mode throws AcceptanceRefusedError + leaves phase in_progress
//   - state.markDone with no success_criteria proceeds (no audit event)
//   - skipAcceptance bypasses validation entirely

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixture, type FixtureBundle } from './fixtures.js';
import {
  AcceptanceRefusedError,
  initState,
  loadContext,
  loadState,
  markDone,
  markInProgress,
  type StateContext,
} from '../src/state.js';
import {
  extractPrRefs,
  resolveEnforceMode,
  validateAcceptance,
} from '../src/acceptance.js';
import type { ChainConfig, PhaseDefinition } from '../src/types.js';

let fx: FixtureBundle;
let ctx: StateContext;

// Helper: rewrite the fixture spec so the phase under test has the criteria
// we want. Reusing makeFixture keeps the rest of the env (CAIA_CHAIN_HOME,
// CAIA_ALERT_*) wired up so the validator runs in a tmpdir-only sandbox.
function rewriteSpec(specPath: string, body: string): void {
  writeFileSync(specPath, body);
}

const SPEC_WITH_CRITERIA = (
  criteria: Record<string, unknown>,
  chainConfig?: Record<string, unknown>,
): string => `
${chainConfig ? `chain_config:\n${Object.entries(chainConfig).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')}` : ''}
defaults:
  max_retries: 2
  max_minutes: 45

phases:
  - id: 1
    name: phase_one
    deps: []
    success_criteria:
${Object.entries(criteria).map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`).join('\n')}
  - id: 2
    name: phase_two
    deps: [1]
`;

beforeEach(() => {
  fx = makeFixture(`acc-${Math.random().toString(36).slice(2, 8)}`);
});

afterEach(() => fx.cleanup());

describe('resolveEnforceMode precedence', () => {
  const phaseStrict: PhaseDefinition = {
    id: 1,
    name: 'p',
    success_criteria: { enforce: 'strict' },
  };
  const phaseWarn: PhaseDefinition = {
    id: 1,
    name: 'p',
    success_criteria: { enforce: 'warn' },
  };
  const phasePhaseField: PhaseDefinition = {
    id: 1,
    name: 'p',
    acceptance_enforce: 'strict',
  };
  const phaseEmpty: PhaseDefinition = { id: 1, name: 'p' };
  const chainStrict: ChainConfig = { acceptance_enforce_default: 'strict' };
  const chainWarn: ChainConfig = { acceptance_enforce_default: 'warn' };

  it('phase success_criteria.enforce wins over chain default', () => {
    expect(resolveEnforceMode(phaseStrict, chainWarn)).toBe('strict');
    expect(resolveEnforceMode(phaseWarn, chainStrict)).toBe('warn');
  });
  it('phase acceptance_enforce used when success_criteria.enforce is absent', () => {
    expect(resolveEnforceMode(phasePhaseField, chainWarn)).toBe('strict');
  });
  it('chain default applied when phase has no enforcement', () => {
    expect(resolveEnforceMode(phaseEmpty, chainStrict)).toBe('strict');
  });
  it('warn is the ultimate default', () => {
    expect(resolveEnforceMode(phaseEmpty, undefined)).toBe('warn');
    expect(resolveEnforceMode(phaseEmpty, {})).toBe('warn');
  });
});

describe('extractPrRefs', () => {
  it('extracts each unique owner/repo/pr triple', () => {
    const log = `
some line https://github.com/foo/bar/pull/123
another https://github.com/foo/bar/pull/123
github.com/baz/qux/pull/9
no match here
`;
    const refs = extractPrRefs(log);
    expect(refs).toEqual([
      { owner: 'foo', repo: 'bar', pr: 123 },
      { owner: 'baz', repo: 'qux', pr: 9 },
    ]);
  });
  it('returns empty array when no PRs', () => {
    expect(extractPrRefs('no urls here')).toEqual([]);
  });
});

describe('validateAcceptance — output_file + grep_match + min_bytes', () => {
  it('all-pass: every check returns ok=true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-'));
    const artifact = join(dir, 'report.md');
    writeFileSync(artifact, 'this report is acceptable and quite long\n');
    const phase: PhaseDefinition = {
      id: 1,
      name: 'p',
      success_criteria: {
        output_file: artifact,
        min_bytes: 10,
        grep_match: 'acceptable',
      },
    };
    const r = validateAcceptance(phase, undefined);
    expect(r.ok).toBe(true);
    expect(r.checks.length).toBe(3);
    for (const c of r.checks) expect(c.ok).toBe(true);
  });

  it('missing output_file flips ok=false', () => {
    const phase: PhaseDefinition = {
      id: 1,
      name: 'p',
      success_criteria: { output_file: '/tmp/nope-does-not-exist.txt' },
    };
    const r = validateAcceptance(phase, undefined);
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/output_file_exists/);
  });

  it('min_bytes shortfall flips ok=false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-'));
    const artifact = join(dir, 'tiny.txt');
    writeFileSync(artifact, 'x');
    const phase: PhaseDefinition = {
      id: 1,
      name: 'p',
      success_criteria: { output_file: artifact, min_bytes: 100 },
    };
    const r = validateAcceptance(phase, undefined);
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/min_bytes/);
  });

  it('grep_match miss flips ok=false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-'));
    const artifact = join(dir, 'r.txt');
    writeFileSync(artifact, 'nothing relevant here');
    const phase: PhaseDefinition = {
      id: 1,
      name: 'p',
      success_criteria: { output_file: artifact, grep_match: 'success_token' },
    };
    const r = validateAcceptance(phase, undefined);
    expect(r.ok).toBe(false);
    expect(r.checks.some((c) => c.kind === 'grep_match' && !c.ok)).toBe(true);
  });

  it('grep_match with invalid regex surfaces a structured failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-'));
    const artifact = join(dir, 'r.txt');
    writeFileSync(artifact, 'hi');
    const phase: PhaseDefinition = {
      id: 1,
      name: 'p',
      success_criteria: { output_file: artifact, grep_match: '[unterminated' },
    };
    const r = validateAcceptance(phase, undefined);
    expect(r.ok).toBe(false);
    expect(r.checks.some((c) => c.kind === 'grep_match' && /invalid/.test(c.reason))).toBe(true);
  });

  it('no success_criteria → ok with zero checks', () => {
    const phase: PhaseDefinition = { id: 1, name: 'p' };
    const r = validateAcceptance(phase, undefined);
    expect(r.ok).toBe(true);
    expect(r.checks).toEqual([]);
  });
});

describe('validateAcceptance — requires_merged_pr', () => {
  it('no PR refs in dispatch log → ok (back-compat with gate-mark-done.sh)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-'));
    const log = join(dir, 'd.log');
    writeFileSync(log, 'no pr references in this log\n');
    const phase: PhaseDefinition = {
      id: 1,
      name: 'p',
      success_criteria: { requires_merged_pr: true },
    };
    const r = validateAcceptance(phase, undefined, { dispatchLogPath: log });
    expect(r.ok).toBe(true);
    expect(r.checks[0]!.reason).toMatch(/no_pr_refs_in_dispatch_log/);
  });

  it('every PR MERGED → ok', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-'));
    const log = join(dir, 'd.log');
    writeFileSync(
      log,
      'merged here: https://github.com/foo/bar/pull/42 and https://github.com/baz/qux/pull/7',
    );
    const phase: PhaseDefinition = {
      id: 1,
      name: 'p',
      success_criteria: { requires_merged_pr: true },
    };
    const r = validateAcceptance(phase, undefined, {
      dispatchLogPath: log,
      ghPrViewer: () => ({ state: 'MERGED' }),
    });
    expect(r.ok).toBe(true);
  });

  it('any PR OPEN → fail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-'));
    const log = join(dir, 'd.log');
    writeFileSync(log, 'https://github.com/foo/bar/pull/42');
    const phase: PhaseDefinition = {
      id: 1,
      name: 'p',
      success_criteria: { requires_merged_pr: true },
    };
    const r = validateAcceptance(phase, undefined, {
      dispatchLogPath: log,
      ghPrViewer: () => ({ state: 'OPEN' }),
    });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/requires_merged_pr/);
  });

  it('gh timeout surfaces as a failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-'));
    const log = join(dir, 'd.log');
    writeFileSync(log, 'https://github.com/foo/bar/pull/42');
    const phase: PhaseDefinition = {
      id: 1,
      name: 'p',
      success_criteria: { requires_merged_pr: true },
    };
    const r = validateAcceptance(phase, undefined, {
      dispatchLogPath: log,
      ghPrViewer: () => ({ state: 'UNKNOWN', timedOut: true }),
    });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/gh_timeout/);
  });
});

describe('state.markDone — warn mode', () => {
  it('emits phase_acceptance_warn audit and still flips status to done', () => {
    rewriteSpec(
      fx.specPath,
      SPEC_WITH_CRITERIA({ output_file: '/tmp/__definitely_missing.txt' }),
    );
    ctx = loadContext(fx.chainId, fx.specPath);
    initState(ctx);
    markInProgress(ctx, '1', 'sess-1');
    const r = markDone(ctx, '1');
    expect(r.acceptance?.ok).toBe(false);
    expect(r.acceptance?.enforce).toBe('warn');
    const state = loadState(ctx);
    expect(state.phase_status['1']!.status).toBe('done');
    const audit = readFileSync(ctx.paths.auditFile, 'utf8');
    expect(audit).toMatch(/phase_acceptance_warn/);
    expect(audit).toMatch(/phase_done/);
  });

  it('all-pass criteria emit phase_acceptance_ok', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-'));
    const artifact = join(dir, 'r.txt');
    writeFileSync(artifact, 'success_token bears\n');
    rewriteSpec(
      fx.specPath,
      SPEC_WITH_CRITERIA({
        output_file: artifact,
        grep_match: 'success_token',
      }),
    );
    ctx = loadContext(fx.chainId, fx.specPath);
    initState(ctx);
    markInProgress(ctx, '1', 'sess-1');
    const r = markDone(ctx, '1');
    expect(r.acceptance?.ok).toBe(true);
    const audit = readFileSync(ctx.paths.auditFile, 'utf8');
    expect(audit).toMatch(/phase_acceptance_ok/);
  });
});

describe('state.markDone — strict mode', () => {
  it('refuses mark-done on failure: phase stays in_progress, throws AcceptanceRefusedError', () => {
    rewriteSpec(
      fx.specPath,
      SPEC_WITH_CRITERIA(
        { output_file: '/tmp/__definitely_missing.txt', enforce: 'strict' },
      ),
    );
    ctx = loadContext(fx.chainId, fx.specPath);
    initState(ctx);
    markInProgress(ctx, '1', 'sess-1');
    expect(() => markDone(ctx, '1')).toThrowError(AcceptanceRefusedError);
    const state = loadState(ctx);
    expect(state.phase_status['1']!.status).toBe('in_progress');
    const audit = readFileSync(ctx.paths.auditFile, 'utf8');
    expect(audit).toMatch(/phase_acceptance_failed/);
    expect(audit).not.toMatch(/"event":"phase_done"/);
  });

  it('strict mode under chain default also refuses', () => {
    rewriteSpec(
      fx.specPath,
      SPEC_WITH_CRITERIA(
        { output_file: '/tmp/__definitely_missing.txt' },
        { acceptance_enforce_default: 'strict' },
      ),
    );
    ctx = loadContext(fx.chainId, fx.specPath);
    initState(ctx);
    markInProgress(ctx, '1', 'sess-1');
    expect(() => markDone(ctx, '1')).toThrowError(AcceptanceRefusedError);
  });

  it('skipAcceptance bypasses validation entirely', () => {
    rewriteSpec(
      fx.specPath,
      SPEC_WITH_CRITERIA(
        { output_file: '/tmp/__definitely_missing.txt', enforce: 'strict' },
      ),
    );
    ctx = loadContext(fx.chainId, fx.specPath);
    initState(ctx);
    markInProgress(ctx, '1', 'sess-1');
    const r = markDone(ctx, '1', { skipAcceptance: true });
    expect(r.acceptance).toBeUndefined();
    const state = loadState(ctx);
    expect(state.phase_status['1']!.status).toBe('done');
  });
});

describe('state.markDone — no success_criteria', () => {
  it('proceeds without acceptance events', () => {
    // Use the default fixture spec (no success_criteria on phase 1).
    ctx = loadContext(fx.chainId, fx.specPath);
    initState(ctx);
    markInProgress(ctx, '1', 'sess-1');
    const r = markDone(ctx, '1');
    expect(r.acceptance?.ok).toBe(true);
    expect(r.acceptance?.checks).toEqual([]);
    const audit = readFileSync(ctx.paths.auditFile, 'utf8');
    // We DO emit phase_acceptance_ok even with no checks (clean audit trail).
    expect(audit).toMatch(/phase_acceptance_ok/);
  });
});
