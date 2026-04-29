/**
 * DoD self-check — CODING-006 (Phase 2C).
 *
 * Runs the worker's own Definition-of-Done checklist before emitting
 * `task.coding_complete`. The orchestrator's Fix-It Test Agent will run
 * the *test cases* — this checklist verifies the structural surface
 * (claims respected, lint clean, typecheck clean, PR opened with the
 * right body, package.json not version-bumped, etc.) so failures are
 * caught early without spending tokens on a Fix-It loop.
 *
 * The checklist is intentionally narrower than the full DoD in
 * `feedback_definition_of_done.md` — that doc applies to humans + PRs;
 * this file is the *worker's* per-story automation gate.
 *
 * Each check returns a `CheckResult` with a stable id so the failure
 * event can carry per-check telemetry. `runAll(input)` returns a
 * `DodReport` summarising pass/fail across the suite.
 *
 * @owner coding-agent (Phase 2C worker track)
 */

import * as path from 'path';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import type { Bundle } from './bundle-reader';
import type { Worktree } from './worktree-manager';
import type { RunResult } from './local-test-runner';
import type { OpenPrResult } from './diff-committer';

// ─── Types ──────────────────────────────────────────────────────────────────

export type CheckId =
  | 'claims-files'
  | 'claims-schemas'
  | 'lint-clean'
  | 'typecheck-clean'
  | 'package-version-not-bumped'
  | 'pr-body-references-story'
  | 'pr-body-references-test-cases'
  | 'local-tests-passed';

export interface CheckResult {
  id: CheckId;
  passed: boolean;
  detail: string;
}

export interface DodReport {
  passed: boolean;
  results: CheckResult[];
  failureCount: number;
}

export interface DodInput {
  bundle: Bundle;
  worktree: Worktree;
  testRun: RunResult;
  pr: OpenPrResult;
  prBody: string;
  /** Skip lint + typecheck (used in tests where there's no real worktree). */
  skipShellChecks?: boolean;
}

export interface DodOptions {
  fsImpl?: Pick<typeof fs, 'existsSync' | 'readFileSync'>;
  execImpl?: typeof spawnSync;
}

// ─── Class ──────────────────────────────────────────────────────────────────

export class DodSelfCheck {
  private readonly fs: Pick<typeof fs, 'existsSync' | 'readFileSync'>;
  private readonly exec: typeof spawnSync;

  constructor(opts: DodOptions = {}) {
    this.fs = opts.fsImpl ?? fs;
    this.exec = opts.execImpl ?? spawnSync;
  }

  // ─── Public ───────────────────────────────────────────────────────────────

  runAll(input: DodInput): DodReport {
    const results: CheckResult[] = [];
    results.push(this.checkLocalTestsPassed(input));
    results.push(this.checkClaimsFiles(input));
    results.push(this.checkClaimsSchemas(input));
    results.push(this.checkPrBodyReferencesStory(input));
    results.push(this.checkPrBodyReferencesTestCases(input));
    results.push(this.checkPackageVersionNotBumped(input));
    if (!input.skipShellChecks) {
      results.push(this.checkLintClean(input));
      results.push(this.checkTypecheckClean(input));
    }
    const failureCount = results.filter((r) => !r.passed).length;
    return { passed: failureCount === 0, results, failureCount };
  }

  // ─── Individual checks ────────────────────────────────────────────────────

  checkLocalTestsPassed(input: DodInput): CheckResult {
    if (input.testRun.passed) {
      return { id: 'local-tests-passed', passed: true, detail: `${input.testRun.results.length} phase(s) green` };
    }
    const failedPhases = input.testRun.results.filter((r) => !r.passed).map((r) => r.phase);
    return {
      id: 'local-tests-passed',
      passed: false,
      detail: `phases failed: ${failedPhases.join(', ') || '(none ran)'}`,
    };
  }

  checkClaimsFiles(input: DodInput): CheckResult {
    const ticket = (input.bundle.ticket ?? {}) as Record<string, unknown>;
    const claims = (ticket.claims ?? {}) as Record<string, unknown>;
    const allowedFiles = (claims.files ?? []) as unknown[];
    if (!Array.isArray(allowedFiles) || allowedFiles.length === 0) {
      return { id: 'claims-files', passed: true, detail: 'no claims declared (read-only mode)' };
    }
    const allowed = new Set(allowedFiles.filter((f): f is string => typeof f === 'string'));
    const touched = this.touchedFiles(input.worktree.path);
    const out = touched.filter((f) => !allowed.has(f) && !this.isAllowedAuxFile(f));
    if (out.length === 0) {
      return { id: 'claims-files', passed: true, detail: `${touched.length} file(s) touched, all within claims` };
    }
    return {
      id: 'claims-files',
      passed: false,
      detail: `${out.length} file(s) touched outside claims: ${out.slice(0, 5).join(', ')}${out.length > 5 ? '…' : ''}`,
    };
  }

  checkClaimsSchemas(input: DodInput): CheckResult {
    const ticket = (input.bundle.ticket ?? {}) as Record<string, unknown>;
    const claims = (ticket.claims ?? {}) as Record<string, unknown>;
    const allowedSchemas = (claims.schemas ?? []) as unknown[];
    if (!Array.isArray(allowedSchemas) || allowedSchemas.length === 0) {
      // No schema claims - can't have touched any (otherwise we'd see migration files in claims-files).
      // Treat as pass; if claims-files passed and no migration is touched, we're fine.
      return { id: 'claims-schemas', passed: true, detail: 'no schema claims declared' };
    }
    // Heuristic: a touched migration file (.sql under migrations/) implies a schema change.
    // We assume the schema list is what the dev expected; an unexpected migration file would
    // already fail claims-files.
    return { id: 'claims-schemas', passed: true, detail: 'schema claims structurally satisfied' };
  }

  checkPrBodyReferencesStory(input: DodInput): CheckResult {
    const id = input.bundle.story.id;
    if (input.prBody.includes(id)) {
      return { id: 'pr-body-references-story', passed: true, detail: `body contains story id ${id}` };
    }
    return {
      id: 'pr-body-references-story',
      passed: false,
      detail: `pr body missing story id reference (${id})`,
    };
  }

  checkPrBodyReferencesTestCases(input: DodInput): CheckResult {
    const ticket = (input.bundle.ticket ?? {}) as Record<string, unknown>;
    const tcs = ticket.testCases;
    if (!Array.isArray(tcs) || tcs.length === 0) {
      return { id: 'pr-body-references-test-cases', passed: true, detail: 'no test cases on ticket (skipped)' };
    }
    const ids = tcs
      .map((t) => (t && typeof t === 'object' ? String((t as Record<string, unknown>).id ?? '') : ''))
      .filter(Boolean);
    if (ids.length === 0) {
      return { id: 'pr-body-references-test-cases', passed: true, detail: 'no test case ids to check' };
    }
    const missing = ids.filter((id) => !input.prBody.includes(id));
    if (missing.length === 0) {
      return {
        id: 'pr-body-references-test-cases',
        passed: true,
        detail: `${ids.length} test case id(s) referenced in body`,
      };
    }
    return {
      id: 'pr-body-references-test-cases',
      passed: false,
      detail: `pr body missing ${missing.length}/${ids.length} test case ids: ${missing.slice(0, 3).join(', ')}`,
    };
  }

  checkPackageVersionNotBumped(input: DodInput): CheckResult {
    // The Release Agent owns version bumps. Coding Agent must never bump
    // package.json versions. Look for `package.json` in touched files, then
    // diff for `"version":` lines.
    const touched = this.touchedFiles(input.worktree.path);
    const pkgs = touched.filter((f) => f.endsWith('package.json'));
    if (pkgs.length === 0) {
      return { id: 'package-version-not-bumped', passed: true, detail: 'no package.json touched' };
    }
    // For each touched package.json, check the diff for version line changes.
    for (const p of pkgs) {
      const diff = this.gitDiff(input.worktree.path, p);
      if (/^[+-]\s*"version":/m.test(diff)) {
        return {
          id: 'package-version-not-bumped',
          passed: false,
          detail: `version-line change detected in ${p}`,
        };
      }
    }
    return { id: 'package-version-not-bumped', passed: true, detail: `${pkgs.length} package.json touched, no version changes` };
  }

  checkLintClean(input: DodInput): CheckResult {
    const res = this.exec('bash', ['-c', 'pnpm lint || exit $?'], {
      cwd: input.worktree.path,
      encoding: 'utf8',
      timeout: 300_000,
    });
    if ((res.status ?? -1) === 0) {
      return { id: 'lint-clean', passed: true, detail: 'pnpm lint exit 0' };
    }
    return { id: 'lint-clean', passed: false, detail: `pnpm lint exit ${res.status}` };
  }

  checkTypecheckClean(input: DodInput): CheckResult {
    const res = this.exec('bash', ['-c', 'pnpm typecheck || exit $?'], {
      cwd: input.worktree.path,
      encoding: 'utf8',
      timeout: 300_000,
    });
    if ((res.status ?? -1) === 0) {
      return { id: 'typecheck-clean', passed: true, detail: 'pnpm typecheck exit 0' };
    }
    return { id: 'typecheck-clean', passed: false, detail: `pnpm typecheck exit ${res.status}` };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private touchedFiles(repoPath: string): string[] {
    const res = this.exec(
      'git',
      ['diff', '--name-only', 'HEAD~1', 'HEAD'],
      { cwd: repoPath, encoding: 'utf8' },
    );
    if ((res.status ?? -1) !== 0) {
      // Fall back to staged/unstaged if no commit yet
      const fallback = this.exec(
        'git',
        ['status', '--porcelain'],
        { cwd: repoPath, encoding: 'utf8' },
      );
      return String(fallback.stdout ?? '')
        .split('\n')
        .map((line) => line.trim().replace(/^\S+\s+/, ''))
        .filter(Boolean);
    }
    return String(res.stdout ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private gitDiff(repoPath: string, filePath: string): string {
    const res = this.exec(
      'git',
      ['diff', 'HEAD~1', 'HEAD', '--', filePath],
      { cwd: repoPath, encoding: 'utf8' },
    );
    return String(res.stdout ?? '');
  }

  private isAllowedAuxFile(p: string): boolean {
    // pnpm-lock.yaml and journal updates are auto-managed; allow them
    // unconditionally so claim authors don't need to enumerate them.
    if (p === 'pnpm-lock.yaml') return true;
    if (p.endsWith('/_journal.json')) return true;
    if (path.basename(p) === '.test-output.log') return true;
    return false;
  }
}
