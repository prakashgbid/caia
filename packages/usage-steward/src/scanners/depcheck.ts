/**
 * depcheck wrapper — `depcheck --json` → UsageFinding[].
 *
 * depcheck JSON: { dependencies[], devDependencies[], missing{}, using{}, invalidFiles{}, invalidDirs{} }
 *
 * Classification: missing-in-package-json = error, unused-dep = error,
 * unused-devDep = info (low signal).
 */
import * as path from 'node:path';
import type { ScannerResult, UsageFinding } from '../types.js';
import { probeBinary, runBinary, tail } from './spawn.js';

const BIN = 'depcheck';

export interface DepcheckRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly binaryOverride?: string;
  readonly stdoutOverride?: string;
  readonly ignorePatterns?: ReadonlyArray<string>;
}

export async function runDepcheck(packageDir: string, opts: DepcheckRunOptions = {}): Promise<ScannerResult> {
  if (opts.stdoutOverride !== undefined) {
    return {
      scanner: 'depcheck', tooling: 'present',
      findings: parseDepcheckJson(opts.stdoutOverride, packageDir),
      durationMs: 0, stdoutTail: tail(opts.stdoutOverride),
    };
  }
  const probe = await probeBinary(opts.binaryOverride ?? BIN);
  if (probe.state === 'absent') {
    return { scanner: 'depcheck', tooling: 'absent', findings: [], durationMs: 0, ...(probe.errorMessage !== undefined ? { errorMessage: probe.errorMessage } : {}) };
  }
  const bin = probe.binaryPath ?? BIN;
  const args: string[] = ['--json'];
  for (const pat of opts.ignorePatterns ?? []) args.push('--ignore-patterns', pat);
  args.push(packageDir);

  const r = await runBinary(bin, args, { cwd: packageDir, timeoutMs: opts.timeoutMs ?? 60_000, ...(opts.signal !== undefined ? { signal: opts.signal } : {}) });
  if (r.notFound) {
    return { scanner: 'depcheck', tooling: 'absent', findings: [], durationMs: r.durationMs, errorMessage: 'binary not found at spawn time' };
  }
  let findings: UsageFinding[];
  try {
    findings = parseDepcheckJson(r.stdout, packageDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      scanner: 'depcheck', tooling: 'failed', findings: [], durationMs: r.durationMs,
      ...(probe.version !== undefined ? { toolVersion: probe.version } : {}), errorMessage: `parse error: ${msg}`,
      stdoutTail: tail(r.stdout), stderrTail: tail(r.stderr),
    };
  }
  return {
    scanner: 'depcheck', tooling: 'present', findings, durationMs: r.durationMs,
    ...(probe.version !== undefined ? { toolVersion: probe.version } : {}),
    stdoutTail: tail(r.stdout), stderrTail: tail(r.stderr),
  };
}

interface DepcheckPayload {
  readonly dependencies?: string[];
  readonly devDependencies?: string[];
  readonly missing?: Record<string, string[]>;
  readonly using?: Record<string, string[]>;
  readonly invalidFiles?: Record<string, string>;
  readonly invalidDirs?: Record<string, string>;
}

export function parseDepcheckJson(stdout: string, packageDir: string): UsageFinding[] {
  const trimmed = stdout.trim();
  if (trimmed === '') return [];
  const start = trimmed.indexOf('{');
  if (start < 0) return [];
  const p = JSON.parse(trimmed.slice(start)) as DepcheckPayload;
  const out: UsageFinding[] = [];
  for (const dep of p.dependencies ?? []) {
    out.push({
      scanner: 'depcheck', kind: 'unused-dependency', severity: 'error',
      packageName: null, filePath: null, symbol: null, dependency: dep,
      message: `dependency \`${dep}\` is declared but never imported`,
      raw: { dep, kind: 'dependency' },
    });
  }
  for (const dep of p.devDependencies ?? []) {
    out.push({
      scanner: 'depcheck', kind: 'unused-dependency', severity: 'info',
      packageName: null, filePath: null, symbol: null, dependency: dep,
      message: `devDependency \`${dep}\` is declared but never imported`,
      raw: { dep, kind: 'devDependency' },
    });
  }
  for (const [dep, files] of Object.entries(p.missing ?? {})) {
    const fl = (files ?? []).map((f) => abs(packageDir, f));
    out.push({
      scanner: 'depcheck', kind: 'missing-in-package-json', severity: 'error',
      packageName: null, filePath: fl[0] ?? null, symbol: null, dependency: dep,
      message: `imported \`${dep}\` is not declared in package.json (used in ${fl.length} file(s))`,
      raw: { dep, files: fl },
    });
  }
  for (const [file, err] of Object.entries(p.invalidFiles ?? {})) {
    out.push({
      scanner: 'depcheck', kind: 'unresolved-import', severity: 'warn',
      packageName: null, filePath: abs(packageDir, file),
      symbol: null, dependency: null,
      message: `parser failed on \`${file}\`: ${err}`,
      raw: { file, err },
    });
  }
  return out;
}

function abs(packageDir: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(packageDir, p);
}
