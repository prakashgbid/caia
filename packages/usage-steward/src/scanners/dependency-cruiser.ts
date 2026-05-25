/**
 * dependency-cruiser wrapper — invokes `depcruise` and normalises into
 * UsageFinding[].
 *
 * dep-cruiser JSON shape (subset we care about):
 * ```
 * {
 *   "modules": [
 *     {
 *       "source": "src/foo.ts",
 *       "orphan": true,
 *       "dependencies": [
 *         { "module": "lodash", "valid": false, "rules": [{ "severity": "error", "name": "no-dev-dep-in-prod" }] }
 *       ]
 *     }
 *   ],
 *   "summary": {
 *     "violations": [
 *       { "from": "src/a.ts", "to": "src/b.ts", "rule": { "severity": "error", "name": "no-circular" } }
 *     ]
 *   }
 * }
 * ```
 *
 * Classification: severity = error → finding.severity = error; severity =
 * warn → warn; severity = info → info. Rule names map directly to
 * UsageFindingKind where possible.
 */

import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { ScannerResult, UsageFinding, UsageFindingKind } from '../types.js';
import { probeBinary, runBinary, tail } from './spawn.js';

const BIN = 'depcruise';

export interface DepCruiserRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly binaryOverride?: string;
  readonly stdoutOverride?: string;
  /** Path (relative to packageDir) of the dep-cruiser config. */
  readonly config?: string;
  /** Subpath under packageDir to crawl (default `src`). */
  readonly entry?: string;
}

export async function runDependencyCruiser(
  packageDir: string,
  opts: DepCruiserRunOptions = {},
): Promise<ScannerResult> {
  if (opts.stdoutOverride !== undefined) {
    return {
      scanner: 'dependency-cruiser',
      tooling: 'present',
      findings: parseDepCruiserJson(opts.stdoutOverride, packageDir),
      durationMs: 0,
      stdoutTail: tail(opts.stdoutOverride),
    };
  }
  const probe = await probeBinary(opts.binaryOverride ?? BIN);
  if (probe.state === 'absent') {
    return { scanner: 'dependency-cruiser', tooling: 'absent', findings: [], durationMs: 0, ...(probe.errorMessage !== undefined ? { errorMessage: probe.errorMessage } : {}) };
  }

  const bin = probe.binaryPath ?? BIN;
  const entry = opts.entry ?? 'src';
  const entryPath = path.isAbsolute(entry) ? entry : path.join(packageDir, entry);
  try {
    await fs.access(entryPath);
  } catch {
    return {
      scanner: 'dependency-cruiser',
      tooling: 'failed',
      findings: [],
      durationMs: 0,
      ...(probe.version !== undefined ? { toolVersion: probe.version } : {}),
      errorMessage: `entry path not found: ${entryPath}`,
    };
  }

  const args: string[] = ['--output-type', 'json'];
  if (opts.config) args.push('--config', opts.config);
  // Synthesise sensible defaults: detect orphans + missing-in-pkg-json
  // even without a config file.
  args.push('--include-only', '^' + (opts.entry ?? 'src'));
  args.push(entry);

  const r = await runBinary(bin, args, {
    cwd: packageDir,
    timeoutMs: opts.timeoutMs ?? 120_000,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
  if (r.notFound) {
    return { scanner: 'dependency-cruiser', tooling: 'absent', findings: [], durationMs: r.durationMs, errorMessage: 'binary not found at spawn time' };
  }
  let findings: UsageFinding[];
  try {
    findings = parseDepCruiserJson(r.stdout, packageDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      scanner: 'dependency-cruiser', tooling: 'failed', findings: [], durationMs: r.durationMs,
      ...(probe.version !== undefined ? { toolVersion: probe.version } : {}), errorMessage: `parse error: ${msg}`,
      stdoutTail: tail(r.stdout), stderrTail: tail(r.stderr),
    };
  }
  return {
    scanner: 'dependency-cruiser', tooling: 'present', findings, durationMs: r.durationMs,
    ...(probe.version !== undefined ? { toolVersion: probe.version } : {}),
    stdoutTail: tail(r.stdout), stderrTail: tail(r.stderr),
  };
}

interface DepCruiserRule {
  readonly name?: string;
  readonly severity?: 'error' | 'warn' | 'info';
}

interface DepCruiserDependency {
  readonly module?: string;
  readonly resolved?: string;
  readonly valid?: boolean;
  readonly couldNotResolve?: boolean;
  readonly rules?: DepCruiserRule[];
}

interface DepCruiserModule {
  readonly source?: string;
  readonly orphan?: boolean;
  readonly dependencies?: DepCruiserDependency[];
}

interface DepCruiserViolation {
  readonly from?: string;
  readonly to?: string;
  readonly cycle?: string[];
  readonly rule?: DepCruiserRule;
}

interface DepCruiserPayload {
  readonly modules?: DepCruiserModule[];
  readonly summary?: { readonly violations?: DepCruiserViolation[] };
}

export function parseDepCruiserJson(stdout: string, packageDir: string): UsageFinding[] {
  const trimmed = stdout.trim();
  if (trimmed === '') return [];
  const start = trimmed.indexOf('{');
  if (start < 0) return [];
  const p = JSON.parse(trimmed.slice(start)) as DepCruiserPayload;
  const out: UsageFinding[] = [];

  for (const m of p.modules ?? []) {
    if (m.orphan && m.source) {
      out.push({
        scanner: 'dependency-cruiser',
        kind: 'orphan-module',
        severity: 'warn',
        packageName: null,
        filePath: abs(packageDir, m.source),
        symbol: null,
        dependency: null,
        message: `module \`${m.source}\` is an orphan (no inbound dep)`,
        raw: { source: m.source },
      });
    }
    for (const d of m.dependencies ?? []) {
      if (d.couldNotResolve) {
        out.push({
          scanner: 'dependency-cruiser',
          kind: 'unresolved-import',
          severity: 'error',
          packageName: null,
          filePath: m.source ? abs(packageDir, m.source) : null,
          symbol: null,
          dependency: d.module ?? null,
          message: `cannot resolve \`${d.module}\` from \`${m.source}\``,
          raw: d,
        });
        continue;
      }
      for (const rule of d.rules ?? []) {
        out.push({
          scanner: 'dependency-cruiser',
          kind: ruleKind(rule.name),
          severity: rule.severity ?? 'warn',
          packageName: null,
          filePath: m.source ? abs(packageDir, m.source) : null,
          symbol: null,
          dependency: d.module ?? null,
          message: `${rule.name ?? 'unknown-rule'}: \`${m.source}\` → \`${d.module}\``,
          raw: { module: m.source, dep: d, rule },
        });
      }
    }
  }
  for (const v of p.summary?.violations ?? []) {
    const cyc = v.cycle && v.cycle.length > 0;
    out.push({
      scanner: 'dependency-cruiser',
      kind: cyc ? 'circular-dependency' : ruleKind(v.rule?.name),
      severity: v.rule?.severity ?? 'warn',
      packageName: null,
      filePath: v.from ? abs(packageDir, v.from) : null,
      symbol: null,
      dependency: v.to ?? null,
      message: cyc
        ? `circular dependency: ${(v.cycle ?? []).join(' → ')}`
        : `${v.rule?.name ?? 'unknown-rule'}: \`${v.from}\` → \`${v.to}\``,
      raw: v,
    });
  }
  return out;
}

function ruleKind(ruleName: string | undefined): UsageFindingKind {
  if (!ruleName) return 'unresolved-import';
  if (/no-circular/i.test(ruleName)) return 'circular-dependency';
  if (/no-orphans?/i.test(ruleName)) return 'orphan-module';
  if (/dev-dep|dev-dependency/i.test(ruleName)) return 'dev-dep-in-prod';
  if (/missing|unresolved/i.test(ruleName)) return 'unresolved-import';
  return 'unresolved-import';
}

function abs(packageDir: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(packageDir, p);
}
