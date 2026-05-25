/**
 * ts-prune wrapper — invokes `ts-prune --project tsconfig.json` and
 * normalises text output into UsageFinding[].
 *
 * ts-prune output shape (one line per unused export):
 *   <relpath>:<line> - <symbol>
 *   <relpath>:<line> - <symbol> (used in module)
 *
 * The `(used in module)` suffix means the symbol is used somewhere
 * inside its own module but never imported externally — that's a
 * less-severe orphan (`warn` not `error`).
 *
 * We treat ts-prune as a cross-check for knip: a finding only ts-prune
 * sees becomes a `static-analysis-disagreement` info-level finding the
 * cross-checker can surface in the dashboard.
 */

import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { ScannerResult, UsageFinding } from '../types.js';
import { probeBinary, runBinary, tail } from './spawn.js';

const BIN = 'ts-prune';

export interface TsPruneRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly binaryOverride?: string;
  readonly stdoutOverride?: string;
  /** tsconfig path relative to packageDir (default `tsconfig.json`). */
  readonly project?: string;
}

export async function runTsPrune(
  packageDir: string,
  opts: TsPruneRunOptions = {},
): Promise<ScannerResult> {
  if (opts.stdoutOverride !== undefined) {
    return {
      scanner: 'ts-prune',
      tooling: 'present',
      findings: parseTsPruneOutput(opts.stdoutOverride, packageDir),
      durationMs: 0,
      stdoutTail: tail(opts.stdoutOverride),
    };
  }

  const probe = await probeBinary(opts.binaryOverride ?? BIN);
  if (probe.state === 'absent') {
    return { scanner: 'ts-prune', tooling: 'absent', findings: [], durationMs: 0, ...(probe.errorMessage !== undefined ? { errorMessage: probe.errorMessage } : {}) };
  }

  const project = opts.project ?? 'tsconfig.json';
  // ts-prune crashes hard if the tsconfig doesn't exist; surface that
  // as a tooling-failed, not absent.
  const projectPath = path.isAbsolute(project) ? project : path.join(packageDir, project);
  try {
    await fs.access(projectPath);
  } catch {
    return {
      scanner: 'ts-prune',
      tooling: 'failed',
      findings: [],
      durationMs: 0,
      ...(probe.version !== undefined ? { toolVersion: probe.version } : {}),
      errorMessage: `tsconfig not found at ${projectPath}`,
    };
  }

  const bin = probe.binaryPath ?? BIN;
  const r = await runBinary(bin, ['--project', project], {
    cwd: packageDir,
    timeoutMs: opts.timeoutMs ?? 90_000,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
  if (r.notFound) {
    return { scanner: 'ts-prune', tooling: 'absent', findings: [], durationMs: r.durationMs, errorMessage: 'binary not found at spawn time' };
  }

  let findings: UsageFinding[];
  try {
    findings = parseTsPruneOutput(r.stdout, packageDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      scanner: 'ts-prune', tooling: 'failed', findings: [], durationMs: r.durationMs,
      ...(probe.version !== undefined ? { toolVersion: probe.version } : {}), errorMessage: `parse error: ${msg}`,
      stdoutTail: tail(r.stdout), stderrTail: tail(r.stderr),
    };
  }
  return {
    scanner: 'ts-prune', tooling: 'present', findings, durationMs: r.durationMs,
    ...(probe.version !== undefined ? { toolVersion: probe.version } : {}),
    stdoutTail: tail(r.stdout), stderrTail: tail(r.stderr),
  };
}

/**
 * Parse ts-prune text output. Each non-empty line is either:
 *   path/to/file.ts:42 - mySymbol
 *   path/to/file.ts:42 - mySymbol (used in module)
 * We tolerate blank lines + the "(skip)" lines ts-prune sometimes emits.
 */
const LINE_RE = /^([^:]+):(\d+)\s+-\s+(\S+)(\s+\(used in module\))?\s*$/;

export function parseTsPruneOutput(stdout: string, packageDir: string): UsageFinding[] {
  const out: UsageFinding[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('(skip)')) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const [, file, , symbol, usedInModule] = m;
    out.push({
      scanner: 'ts-prune',
      kind: 'unused-export',
      severity: usedInModule ? 'warn' : 'error',
      packageName: null,
      filePath: path.isAbsolute(file ?? '') ? (file ?? null) : (file ? path.join(packageDir, file) : null),
      symbol: symbol ?? null,
      dependency: null,
      message: usedInModule
        ? `export \`${symbol}\` used only in its own module`
        : `unused export \`${symbol}\``,
      raw: { line },
    });
  }
  return out;
}
