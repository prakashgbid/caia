/**
 * Vitest tests for @chiefaia/verifier — covers the two scenarios required
 * by the B15.D phase brief:
 *   1) POSITIVE — verifier verdict overall='pass' produces ok=true and
 *      the orchestrator-side worktree cleanup runs on the success path.
 *   2) NEGATIVE — verifier verdict overall='fail' produces ok=false and
 *      cleanup STILL runs (proves the try/finally semantics).
 *
 * Plus four supporting tests covering schema validation, prompt rendering,
 * and the wrapper-script cleanup audit trail.
 */

import { describe, expect, it, vi } from 'vitest';

import { isBlockingForRouting, runVerifier } from '../src/agent.js';
import { buildVerifierPrompt, loadVerdictSchema } from '../src/prompt-builder.js';
import type {
  VerifierSpawnInputs,
  VerifierVerdict
} from '../src/types.js';
import { parseAndValidateVerdict, validateVerifierVerdict } from '../src/verdict-validator.js';

const FIXTURE_INPUTS: VerifierSpawnInputs = {
  verifierSpawnId: 'spawn::ver-fixture',
  implementingSpawnId: 'spawn::imp-fixture',
  taskId: 'node::test-1',
  prUrl: 'https://github.com/x/y/pull/42',
  prBranch: 'feat/fixture',
  prBaseSha: '0000000000000000000000000000000000000000',
  prHeadSha: '1111111111111111111111111111111111111111',
  verifierWorktree: '/tmp/verifier_node--test-1-spawn--ver-fixture',
  routingClass: 'autonomous-loop',
  spec: {
    title: 'fixture: insert MIT SPDX header',
    workDirective: 'Insert `// SPDX-License-Identifier: MIT` as the first line of packages/foo/src/index.ts.',
    parentContext: 'foo package licensing rollout',
    techContext: ['TypeScript ES module package', 'pnpm monorepo'],
    architecturalConstraints: ['No new runtime deps'],
    dodRequiredStages: ['Implement', 'Unit-test'],
    acceptanceCriteria: [
      'Given the file packages/foo/src/index.ts, When opened, Then the first line MUST be `// SPDX-License-Identifier: MIT`',
      'Given pnpm test:filter @chiefaia/foo, When run against HEAD, Then it MUST pass'
    ],
    fileScope: ['packages/foo/src/index.ts'],
    testsRequired: [{ kind: 'unit', name: 'packages/foo/tests/index.test.ts' }],
    testsFilterExpr: '@chiefaia/foo'
  },
  implementorClaim: {
    ok: true,
    task_id: 'node::test-1',
    spawn_id: 'spawn::imp-fixture',
    files_touched: [{ path: 'packages/foo/src/index.ts', additions: 1, deletions: 0 }],
    commits_made: [{ sha: '1111111', message_subject: 'feat(foo): SPDX header' }],
    acceptance_criteria_self_cert: [
      { ac: 'AC1', self_status: 'met', evidence: 'first line of index.ts' },
      { ac: 'AC2', self_status: 'met', evidence: 'unit test green' }
    ],
    tests_required_self_cert: [
      { test: 'packages/foo/tests/index.test.ts', self_status: 'passing', evidence: '1/1 pass in 12ms' }
    ],
    dod_self_cert: [
      { stage: 'Implement', self_status: 'done', evidence: 'commit 1111111' },
      { stage: 'Unit-test', self_status: 'done', evidence: 'all green' }
    ],
    ready_for_verifier: true,
    reason_class: null,
    reason_evidence: '',
    summary: 'SPDX header added'
  }
};

function passingVerdict(input: Pick<VerifierVerdict, 'verifier_spawn_id' | 'implementing_spawn_id' | 'task_id'>): VerifierVerdict {
  return {
    schema_version: 'v1',
    verifier_spawn_id: input.verifier_spawn_id,
    implementing_spawn_id: input.implementing_spawn_id,
    task_id: input.task_id,
    pr_url: 'https://github.com/x/y/pull/42',
    pr_head_sha: '1111111111111111111111111111111111111111',
    overall: 'pass',
    verdict: 'pass',
    acceptance_criteria_verdicts: [
      { ac: 'AC1', verdict: 'met', evidence: 'first line of index.ts after diff', implementor_self_cert_matches: true },
      { ac: 'AC2', verdict: 'met', evidence: 'unit runner output 1/1 pass', implementor_self_cert_matches: true }
    ],
    tests_required_verdicts: [
      { test: 'packages/foo/tests/index.test.ts', verdict: 'passing', runner_output_excerpt: 'PASS  1/1 in 12ms', implementor_self_cert_matches: true }
    ],
    tests_run_verdict: true,
    file_scope_verdict: true,
    dod_stages_verdicts: [
      { stage: 'Implement', verdict: 'evidenced', evidence: 'header insert hunk' },
      { stage: 'Unit-test', verdict: 'evidenced', evidence: 'test green' }
    ],
    out_of_scope_files_touched: [],
    architectural_constraint_violations: [],
    recommendation: 'merge',
    reasons: [],
    blocking: true,
    summary: 'all ACs met, all tests passing, file scope honoured',
    verifier_worktree_cleaned_up: true
  };
}

function failingVerdict(input: Pick<VerifierVerdict, 'verifier_spawn_id' | 'implementing_spawn_id' | 'task_id'>): VerifierVerdict {
  return {
    schema_version: 'v1',
    verifier_spawn_id: input.verifier_spawn_id,
    implementing_spawn_id: input.implementing_spawn_id,
    task_id: input.task_id,
    pr_url: 'https://github.com/x/y/pull/42',
    pr_head_sha: '1111111111111111111111111111111111111111',
    overall: 'fail',
    verdict: 'fail-impl',
    acceptance_criteria_verdicts: [
      { ac: 'AC1', verdict: 'not-met', evidence: 'first line of index.ts is unchanged', implementor_self_cert_matches: false }
    ],
    tests_required_verdicts: [
      { test: 'packages/foo/tests/index.test.ts', verdict: 'failing', runner_output_excerpt: 'FAIL — assertion line 12', implementor_self_cert_matches: false }
    ],
    tests_run_verdict: false,
    file_scope_verdict: true,
    dod_stages_verdicts: [
      { stage: 'Implement', verdict: 'missing-evidence', evidence: 'no SPDX hunk in diff' }
    ],
    out_of_scope_files_touched: [],
    architectural_constraint_violations: [],
    recommendation: 're-implement',
    reasons: ['AC1 not-met: first line of index.ts is unchanged', 'unit test failing'],
    blocking: true,
    summary: 'AC1 not-met; tests failing — re-implement',
    verifier_worktree_cleaned_up: true
  };
}

describe('VerifierAgent — POSITIVE: pass verdict transitions to ok=true', () => {
  it('captures the verdict, marks ok, and runs cleanup with reason=success', async () => {
    const cleanupCalls: Array<'success' | 'exception' | 'timeout' | 'sigterm'> = [];
    const fakeWorktreeFactory = vi.fn().mockImplementation(() => ({
      path: '/tmp/verifier_TEST-positive',
      jobId: 'TEST-positive',
      cleanup: async (reason: 'success' | 'exception' | 'timeout' | 'sigterm') => {
        cleanupCalls.push(reason);
      },
      cleanupReason: () => cleanupCalls[0] ?? null,
      cleanedUp: () => cleanupCalls.length > 0
    }));
    const verdictBlob = passingVerdict({
      verifier_spawn_id: FIXTURE_INPUTS.verifierSpawnId,
      implementing_spawn_id: FIXTURE_INPUTS.implementingSpawnId,
      task_id: FIXTURE_INPUTS.taskId
    });
    const fakeRunChild = vi.fn().mockResolvedValue({
      rc: 0,
      stdout: 'some intermediate noise\n' + JSON.stringify(verdictBlob) + '\n',
      stderr: '',
      timedOut: false
    });

    const inputsNoWorktree = { ...FIXTURE_INPUTS, verifierWorktree: '' };
    const out = await runVerifier({
      inputs: inputsNoWorktree,
      config: {
        repoPath: '/tmp/fake-repo',
        runChild: fakeRunChild,
        worktreeFactory: fakeWorktreeFactory
      }
    });
    expect(out.ok).toBe(true);
    expect(out.verdict).not.toBeNull();
    expect(out.verdict?.overall).toBe('pass');
    expect(out.verdict?.verdict).toBe('pass');
    expect(out.failureReason).toBeNull();
    expect(out.cleanupReason).toBe('success');
    expect(out.worktreeCleanedUp).toBe(true);
    expect(cleanupCalls).toEqual(['success']);
  });
});

describe('VerifierAgent — NEGATIVE: fail verdict surfaces ok=false but cleanup STILL runs', () => {
  it('captures the fail verdict and runs cleanup on the failure path', async () => {
    const cleanupCalls: Array<'success' | 'exception' | 'timeout' | 'sigterm'> = [];
    const fakeWorktreeFactory = vi.fn().mockImplementation(() => ({
      path: '/tmp/verifier_TEST-negative',
      jobId: 'TEST-negative',
      cleanup: async (reason: 'success' | 'exception' | 'timeout' | 'sigterm') => {
        cleanupCalls.push(reason);
      },
      cleanupReason: () => cleanupCalls[0] ?? null,
      cleanedUp: () => cleanupCalls.length > 0
    }));
    const verdictBlob = failingVerdict({
      verifier_spawn_id: FIXTURE_INPUTS.verifierSpawnId,
      implementing_spawn_id: FIXTURE_INPUTS.implementingSpawnId,
      task_id: FIXTURE_INPUTS.taskId
    });
    const fakeRunChild = vi.fn().mockResolvedValue({
      rc: 0,
      stdout: JSON.stringify(verdictBlob) + '\n',
      stderr: '',
      timedOut: false
    });

    const inputsNoWorktree = { ...FIXTURE_INPUTS, verifierWorktree: '' };
    const out = await runVerifier({
      inputs: inputsNoWorktree,
      config: {
        repoPath: '/tmp/fake-repo',
        runChild: fakeRunChild,
        worktreeFactory: fakeWorktreeFactory
      }
    });
    expect(out.ok).toBe(false); // overall='fail' => ok=false
    expect(out.verdict).not.toBeNull();
    expect(out.verdict?.overall).toBe('fail');
    expect(out.verdict?.verdict).toBe('fail-impl');
    expect(out.verdict?.reasons.length).toBeGreaterThan(0);
    // CRITICAL: cleanup STILL runs on the failure path (try/finally).
    expect(out.cleanupReason).toBe('success'); // success === non-exception child
    expect(out.worktreeCleanedUp).toBe(true);
    expect(cleanupCalls).toEqual(['success']);
  });
});

describe('VerifierAgent — exception path also cleans up', () => {
  it('runs cleanup with reason=exception when the spawn throws', async () => {
    const cleanupCalls: Array<'success' | 'exception' | 'timeout' | 'sigterm'> = [];
    const fakeWorktreeFactory = vi.fn().mockImplementation(() => ({
      path: '/tmp/verifier_TEST-exception',
      jobId: 'TEST-exception',
      cleanup: async (reason: 'success' | 'exception' | 'timeout' | 'sigterm') => {
        cleanupCalls.push(reason);
      },
      cleanupReason: () => cleanupCalls[0] ?? null,
      cleanedUp: () => cleanupCalls.length > 0
    }));
    const fakeRunChild = vi.fn().mockRejectedValue(new Error('simulated child crash'));

    const inputsNoWorktree = { ...FIXTURE_INPUTS, verifierWorktree: '' };
    const out = await runVerifier({
      inputs: inputsNoWorktree,
      config: {
        repoPath: '/tmp/fake-repo',
        runChild: fakeRunChild,
        worktreeFactory: fakeWorktreeFactory
      }
    });
    expect(out.ok).toBe(false);
    expect(out.cleanupReason).toBe('exception');
    expect(out.worktreeCleanedUp).toBe(true);
    expect(cleanupCalls).toEqual(['exception']);
    expect(out.failureReason).toContain('simulated child crash');
  });
});

describe('verdict schema validation', () => {
  it('accepts a well-formed pass verdict', () => {
    const v = passingVerdict({ verifier_spawn_id: 'a', implementing_spawn_id: 'b', task_id: 'c' });
    const r = validateVerifierVerdict(v);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it('rejects a verdict missing schema_version', () => {
    const v = passingVerdict({ verifier_spawn_id: 'a', implementing_spawn_id: 'b', task_id: 'c' });
    const broken = { ...v };
    delete (broken as Partial<VerifierVerdict>).schema_version;
    const r = validateVerifierVerdict(broken);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('schema_version');
  });
  it('rejects a verdict with bad overall enum value', () => {
    const v = passingVerdict({ verifier_spawn_id: 'a', implementing_spawn_id: 'b', task_id: 'c' });
    const broken = { ...v, overall: 'nope' as 'pass' };
    const r = validateVerifierVerdict(broken);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('overall');
  });
  it('rejects malformed JSON last-line', () => {
    const r = parseAndValidateVerdict('this is not JSON');
    expect(r.ok).toBe(false);
    expect(r.verdict).toBeNull();
    expect(r.errors[0]).toContain('JSON.parse');
  });
});

describe('prompt rendering', () => {
  it('renders the spawn prompt with all fixture placeholders substituted', () => {
    const prompt = buildVerifierPrompt(FIXTURE_INPUTS);
    expect(prompt).toContain('You are the VERIFIER spawn.');
    expect(prompt).toContain(FIXTURE_INPUTS.verifierSpawnId);
    expect(prompt).toContain(FIXTURE_INPUTS.implementingSpawnId);
    expect(prompt).toContain(FIXTURE_INPUTS.taskId);
    expect(prompt).toContain(FIXTURE_INPUTS.prUrl);
    expect(prompt).toContain(FIXTURE_INPUTS.prBaseSha);
    expect(prompt).toContain(FIXTURE_INPUTS.prHeadSha);
    expect(prompt).toContain(FIXTURE_INPUTS.verifierWorktree);
    expect(prompt).toContain('routing_class          : autonomous-loop');
    expect(prompt).toContain('blocking               : true');
    // Both ACs from the fixture appear with positional numbering.
    expect(prompt).toContain('1. Given the file packages/foo/src/index.ts');
    expect(prompt).toContain('2. Given pnpm test:filter');
    // The implementor's self-cert appears verbatim in the prompt.
    expect(prompt).toContain('"task_id": "node::test-1"');
    // The schema appears verbatim too.
    expect(prompt).toContain('verifier_verdict.v1.json');
  });

  it('flips blocking flag to false for operator-routed', () => {
    const inputs = { ...FIXTURE_INPUTS, routingClass: 'operator-routed' as const };
    const prompt = buildVerifierPrompt(inputs);
    expect(prompt).toContain('routing_class          : operator-routed');
    expect(prompt).toContain('blocking               : false');
  });
});

describe('isBlockingForRouting', () => {
  it('returns true for autonomous-loop, false for operator-routed', () => {
    expect(isBlockingForRouting('autonomous-loop')).toBe(true);
    expect(isBlockingForRouting('operator-routed')).toBe(false);
  });
});

describe('schema is well-formed', () => {
  it('loadVerdictSchema returns a valid JSON Schema object', () => {
    const s = loadVerdictSchema();
    expect(s.$schema).toContain('json-schema.org');
    expect(s.title).toContain('Verifier Verdict');
    expect((s.required as string[]).includes('overall')).toBe(true);
    expect((s.required as string[]).includes('blocking')).toBe(true);
  });
});
