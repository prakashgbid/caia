/**
 * Knip wrapper — invokes `knip --reporter json` and normalises the
 * output into `UsageFinding[]`.
 *
 * Knip's JSON shape (as of knip ≥ 5.x):
 * ```
 * {
 *   "files": ["path/to/orphan.ts", …],
 *   "issues": [
 *     {
 *       "file": "path/to/file.ts",
 *       "owners": ["@caia/foo"],
 *       "exports":         [{ "name": "X", "line": 12, "col": 4 }, …],
 *       "types":           [{ "name": "Y", "line": 15, "col": 4 }, …],
 *       "nsExports":       [{ "name": "*",  "line": 1, "col": 1 }, …],
 *       "enumMembers":     [{ "name": "X.A", "line": 7, "col": 4 }, …],
 *       "classMembers":    [{ "name": "X.m", "line": 7, "col": 4 }, …],
 *       "dependencies":    [{ "name": "pkg",  "line": 0, "col": 0 }, …],
 *       "devDependencies": [{ "name": "pkg",  "line": 0, "col": 0 }, …],
 *       "unlisted":        [{ "name": "pkg",  "line": 0, "col": 0 }, …]
 *     }, …
 *   ]
 * }
 * ```
 *
 * The wrapper is tolerant of older shapes (`issues` instead of nested,
 * etc.) so it doesn't break across knip minor versions.
 */

import * as path from 'node:path';
import type { ScannerResult, UsageFinding } from '../types.js';
import { probeBinary, runBinary, tail } from './spawn.js';

const KNIP_BIN = 'knip';

export interface KnipRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /**
   * If true, run with `--production` to focus on prod-import paths
   * (skips devDeps + test-only files). Default true — the steward is
   * about deploy-time correctness, not dev-experience.
   */
  readonly production?: boolean;
  /**
   * Override the binary used (tests inject a stub script).
   */
  readonly binaryOverride?: string;
  /**
   * Override stdout used instead of spawning the binary. Tests use
   * this to avoid `which knip`. When set, the wrapper skips spawn
   * entirely and just parses the provided text.
   */
  readonly stdoutOverride?: string;
}

export async function runKnip(
  packageDir: string,
  opts: KnipRunOptions = {},
): Promise<ScannerResult> {
  if (opts.stdoutOverride !== undefined) {
    const findings = parseKnipJson(opts.stdoutOverride, packageDir);
    return {
      scanner: 'knip',
      tooling: 'present',
      findings,
      durationMs: 0,
      stdoutTail: tail(opts.stdoutOverride),
    };
  }

  const probe = await probeBinary(opts.binaryOverride ?? KNIP_BIN);
  if (probe.state === 'absent') {
    return {
      scanner: 'knip',
      tooling: 'absent',
      findings: [],
      durationMs: 0,
      ...(probe.errorMessage !== undefined ? { errorMessage: probe.errorMessage } : {}),
    };
  }
  const bin = probe.binaryPath ?? KNIP_BIN;
  const args = ['--reporter', 'json', '--no-progress'];
  if (opts.production !== false) args.push('--production');

  const spawnRes = await runBinary(bin, args, {
    cwd: packageDir,
    timeoutMs: opts.timeoutMs ?? 90_000,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });

  if (spawnRes.notFound) {
    return {
      scanner: 'knip',
      tooling: 'absent',
      findings: [],
      durationMs: spawnRes.durationMs,
      errorMessage: 'binary not found at spawn time',
    };
  }
  // Knip exits non-zero when it finds issues — that's not a tooling
  // failure for our purposes. We only treat parse errors as 'failed'.
  let findings: UsageFinding[];
  try {
    findings = parseKnipJson(spawnRes.stdout, packageDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      scanner: 'knip',
      tooling: 'failed',
      findings: [],
      durationMs: spawnRes.durationMs,
      ...(probe.version !== undefined ? { toolVersion: probe.version } : {}),
      errorMessage: `parse error: ${msg}`,
      stdoutTail: tail(spawnRes.stdout),
      stderrTail: tail(spawnRes.stderr),
    };
  }
  return {
    scanner: 'knip',
    tooling: 'present',
    findings,
    durationMs: spawnRes.durationMs,
    ...(probe.version !== undefined ? { toolVersion: probe.version } : {}),
    stdoutTail: tail(spawnRes.stdout),
    stderrTail: tail(spawnRes.stderr),
  };
}

// ─── Parsing ────────────────────────────────────────────────────────────────

interface KnipIssueLocator {
  readonly name: string;
  readonly line?: number;
  readonly col?: number;
  readonly symbol?: string;
}

interface KnipIssue {
  readonly file?: string;
  readonly owners?: string[];
  readonly exports?: KnipIssueLocator[];
  readonly types?: KnipIssueLocator[];
  readonly nsExports?: KnipIssueLocator[];
  readonly nsTypes?: KnipIssueLocator[];
  readonly enumMembers?: KnipIssueLocator[];
  readonly classMembers?: KnipIssueLocator[];
  readonly dependencies?: KnipIssueLocator[];
  readonly devDependencies?: KnipIssueLocator[];
  readonly unlisted?: KnipIssueLocator[];
  readonly unresolved?: KnipIssueLocator[];
}

interface KnipPayload {
  readonly files?: string[];
  readonly issues?: KnipIssue[];
}

export function parseKnipJson(stdout: string, packageDir: string): UsageFinding[] {
  const trimmed = stdout.trim();
  if (trimmed === '') return [];

  // Knip 5+ emits a JSON object even on no issues; tolerate a stray
  // header line by hunting for the first '{'.
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart < 0) return [];
  const payload = JSON.parse(trimmed.slice(jsonStart)) as KnipPayload;

  const findings: UsageFinding[] = [];

  for (const file of payload.files ?? []) {
    findings.push({
      scanner: 'knip',
      kind: 'unused-file',
      severity: 'error',
      packageName: ownerOfFile(file, packageDir),
      filePath: absolute(packageDir, file),
      symbol: null,
      dependency: null,
      message: `orphan file (no inbound import)`,
      raw: { file },
    });
  }

  for (const issue of payload.issues ?? []) {
    const owner = issue.owners?.[0] ?? ownerOfFile(issue.file ?? '', packageDir);
    const abs = issue.file ? absolute(packageDir, issue.file) : null;

    for (const loc of issue.exports ?? []) {
      findings.push(mkSymbolFinding('unused-export', 'error', owner, abs, loc, 'unused export'));
    }
    for (const loc of issue.types ?? []) {
      findings.push(mkSymbolFinding('unused-export', 'warn', owner, abs, loc, 'unused type export'));
    }
    for (const loc of issue.nsExports ?? []) {
      findings.push(mkSymbolFinding('unused-export', 'warn', owner, abs, loc, 'unused namespace export'));
    }
    for (const loc of issue.nsTypes ?? []) {
      findings.push(mkSymbolFinding('unused-export', 'warn', owner, abs, loc, 'unused namespace type'));
    }
    for (const loc of issue.enumMembers ?? []) {
      findings.push(mkSymbolFinding('unused-enum-member', 'warn', owner, abs, loc, 'unused enum member'));
    }
    for (const loc of issue.classMembers ?? []) {
      findings.push(mkSymbolFinding('unused-class-member', 'warn', owner, abs, loc, 'unused class member'));
    }
    for (const loc of issue.dependencies ?? []) {
      findings.push({
        scanner: 'knip',
        kind: 'unused-dependency',
        severity: 'error',
        packageName: owner ?? null,
        filePath: abs,
        symbol: null,
        dependency: loc.name,
        message: `declared dependency \`${loc.name}\` is never imported`,
        raw: loc,
      });
    }
    for (const loc of issue.devDependencies ?? []) {
      findings.push({
        scanner: 'knip',
        kind: 'unused-dependency',
        severity: 'info',
        packageName: owner ?? null,
        filePath: abs,
        symbol: null,
        dependency: loc.name,
        message: `declared devDependency \`${loc.name}\` is never imported`,
        raw: loc,
      });
    }
    for (const loc of issue.unlisted ?? []) {
      findings.push({
        scanner: 'knip',
        kind: 'unlisted-dependency',
        severity: 'error',
        packageName: owner ?? null,
        filePath: abs,
        symbol: null,
        dependency: loc.name,
        message: `imported \`${loc.name}\` is not in package.json`,
        raw: loc,
      });
    }
    for (const loc of issue.unresolved ?? []) {
      findings.push({
        scanner: 'knip',
        kind: 'unresolved-import',
        severity: 'error',
        packageName: owner ?? null,
        filePath: abs,
        symbol: null,
        dependency: loc.name,
        message: `import \`${loc.name}\` could not be resolved`,
        raw: loc,
      });
    }
  }
  return findings;
}

function mkSymbolFinding(
  kind: 'unused-export' | 'unused-enum-member' | 'unused-class-member',
  severity: 'error' | 'warn' | 'info',
  owner: string | null | undefined,
  abs: string | null,
  loc: KnipIssueLocator,
  msgPrefix: string,
): UsageFinding {
  return {
    scanner: 'knip',
    kind,
    severity,
    packageName: owner ?? null,
    filePath: abs,
    symbol: loc.name,
    dependency: null,
    message: `${msgPrefix}: \`${loc.name}\``,
    raw: loc,
  };
}

function ownerOfFile(filePath: string, packageDir: string): string | null {
  if (filePath === '') return null;
  const rel = path.isAbsolute(filePath) ? path.relative(packageDir, filePath) : filePath;
  if (rel.startsWith('..')) return null;
  return null; // owner resolution is the cross-checker's job
}

function absolute(packageDir: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(packageDir, p);
}
