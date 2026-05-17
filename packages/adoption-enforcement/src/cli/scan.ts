// `caia-adoption-run scan` — read a merged PR, invoke phases 2/3/4 detectors,
// emit a unified `scan.json` (artefact rows) under
// `~/.caia/post-merge/work/<sha>/`.
//
// Pipeline:
//   1. New packages (phase 3)  → detectNewPackages(pr)
//   2. New exports  (phase 2)  → detectNewExports(indexPath) per touched
//                                 `packages/<X>/src/index.ts`
//   3. New external agents (phase 4) → detectNewExternalAgents(repoRoot)
//
// Output shape (consumed by `caia-adoption-run xref`):
//   {
//     version: 1,
//     sha: "<merge-sha>",
//     pr: <number>,
//     generated_at: "<iso>",
//     artefacts: [ { kind, package, identifier, source_path, ... } ]
//   }
//
// Idempotent: skips if `scan.json` already exists in the work dir, unless
// `--force` is given.
//
// Companion design: agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md.
// Companion chain : p3-adoption-scan-engine phase 5.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';

import {
  detectNewExports,
  detectNewExternalAgents,
  detectNewPackages,
} from '../scan/index.js';
import type {
  GhPrFile,
  NewExportRow,
  NewExternalAgentRow,
  NewPackageRow,
} from '../scan/types.js';

import type { CliResult } from './xref.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScanOptions {
  /** PR number (positive integer). */
  pr: number;
  /** Merge commit SHA. When omitted, derived via `gh pr view <pr>`. */
  sha?: string;
  /** Output directory. Default: `~/.caia/post-merge/work/<sha>/`. */
  outDir?: string;
  /** Repository root the gh paths are resolved against. Default `process.cwd()`. */
  repoRoot?: string;
  /** Regenerate even if `scan.json` exists. Default false. */
  force?: boolean;
  /**
   * Injection point for tests. Replaces the real `gh pr view <pr> --json files,mergeCommit`
   * invocation. Receives the PR number, must return the parsed JSON.
   */
  runGh?: (pr: number) => GhPrViewResult;
}

/** Subset of `gh pr view --json files,mergeCommit` we consume. */
export interface GhPrViewResult {
  readonly files: readonly GhPrFile[];
  readonly mergeCommit?: { oid?: string | null } | null;
}

export type ArtefactRow =
  | NewExportArtefact
  | NewPackageArtefact
  | NewExternalAgentArtefact;

export interface NewExportArtefact {
  readonly kind: 'new_export';
  readonly package: string;
  readonly identifier: string;
  readonly source_path: string;
  readonly decl_kind: NewExportRow['decl_kind'];
  readonly isTypeOnly: boolean;
}

export interface NewPackageArtefact {
  readonly kind: 'new_package';
  readonly package: string;
  readonly identifier: string;
  readonly source_path: string;
}

export interface NewExternalAgentArtefact {
  readonly kind: 'new_external_agent';
  readonly package: string;
  readonly identifier: string;
  readonly source_path: string;
  readonly agent_kind: NewExternalAgentRow['agent_kind'];
  readonly repo: string;
  readonly capabilities: readonly string[];
  readonly suggested_call_sites: readonly string[];
}

export interface ScanFile {
  readonly version: 1;
  readonly sha: string;
  readonly pr: number;
  readonly generated_at: string;
  readonly artefacts: readonly ArtefactRow[];
  readonly summary: {
    readonly artefact_count: number;
    readonly new_package_count: number;
    readonly new_export_count: number;
    readonly new_external_agent_count: number;
  };
}

export interface RunScanResult {
  readonly outPath: string;
  /** True when scan.json was newly written; false when skipped (idempotent). */
  readonly written: boolean;
  readonly scan: ScanFile;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const PACKAGE_INDEX_PATTERN = /^packages\/([^/]+)\/src\/index\.ts$/;

export function runScan(opts: ScanOptions): RunScanResult {
  if (!Number.isInteger(opts.pr) || opts.pr <= 0) {
    throw new Error(`scan: --pr must be a positive integer, got ${opts.pr}`);
  }
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const runGh = opts.runGh ?? defaultRunGh;

  const ghResult = runGh(opts.pr);
  const sha = opts.sha ?? ghResult.mergeCommit?.oid ?? null;
  if (!sha || typeof sha !== 'string') {
    throw new Error(
      `scan: could not resolve merge sha (pass --sha or merge the PR first)`,
    );
  }

  const outDir = path.resolve(opts.outDir ?? defaultOutDir(sha));
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'scan.json');

  if (!opts.force && existsSync(outPath)) {
    const existing = JSON.parse(readFileSync(outPath, 'utf8')) as ScanFile;
    return { outPath, written: false, scan: existing };
  }

  const artefacts: ArtefactRow[] = [];

  // ---- phase 3 — new packages (also covers their `new_export` rows). ----
  const packagesResult = detectNewPackages(opts.pr, {
    repoRoot,
    runGh: () => ({ files: ghResult.files }),
  });

  // Tracks `packages/<X>` we already covered via the new-packages branch so
  // we don't double-emit when phase 2 would otherwise re-walk the same index.
  const coveredPackagePaths = new Set<string>();

  for (const row of packagesResult.rows) {
    if (row.kind === 'new_package') {
      coveredPackagePaths.add(row.packagePath);
      artefacts.push(toPackageArtefact(row));
    } else if (row.kind === 'new_export') {
      artefacts.push(toExportArtefact(row));
    }
  }

  // ---- phase 2 — new exports for *modified* (not added) packages. ----
  const modifiedIndexFiles = ghResult.files.filter(
    (f) =>
      f.changeType !== 'ADDED' &&
      f.changeType !== 'REMOVED' &&
      PACKAGE_INDEX_PATTERN.test(f.path),
  );

  for (const file of modifiedIndexFiles) {
    const m = PACKAGE_INDEX_PATTERN.exec(file.path);
    if (m === null) continue;
    const packagePath = `packages/${m[1]}`;
    if (coveredPackagePaths.has(packagePath)) continue;

    const indexAbs = path.resolve(repoRoot, file.path);
    if (!existsSync(indexAbs)) continue;

    const pkgJsonAbs = path.resolve(repoRoot, packagePath, 'package.json');
    if (!existsSync(pkgJsonAbs)) continue;
    const packageName = readPackageName(pkgJsonAbs);
    if (packageName === null) continue;

    // Phase-2 detector compares against the per-package snapshot, then
    // rewrites the snapshot atomically. First scan of a package treats every
    // export as new — by design.
    const result = detectNewExports(indexAbs);
    for (const exportRow of result.newExports) {
      artefacts.push({
        kind: 'new_export',
        package: packageName,
        identifier: exportRow.identifier,
        source_path: `${packagePath}/src/index.ts`,
        decl_kind: exportRow.decl_kind,
        isTypeOnly: exportRow.isTypeOnly,
      });
    }
  }

  // ---- phase 4 — new external agents (whole-repo). ----
  // Only fires when `.adoption/external-agents.yaml` was touched in the PR;
  // otherwise the snapshot is up-to-date and the detector still no-ops, but
  // we skip the call to avoid writing a snapshot on every scan.
  const externalAgentsTouched = ghResult.files.some(
    (f) =>
      f.path === '.adoption/external-agents.yaml' ||
      f.path.endsWith('/.adoption/external-agents.yaml'),
  );
  if (externalAgentsTouched) {
    const externalResult = detectNewExternalAgents(repoRoot);
    if (!externalResult.configMissing) {
      const sourcePath = path.relative(repoRoot, externalResult.configPath);
      for (const row of externalResult.rows) {
        artefacts.push({
          kind: 'new_external_agent',
          package: row.name,
          identifier: row.name,
          source_path: sourcePath,
          agent_kind: row.agent_kind,
          repo: row.repo,
          capabilities: row.capabilities,
          suggested_call_sites: row.suggested_call_sites,
        });
      }
    }
  }

  const summary = summarize(artefacts);
  const scan: ScanFile = {
    version: 1,
    sha,
    pr: opts.pr,
    generated_at: new Date().toISOString(),
    artefacts,
    summary,
  };

  writeFileSync(outPath, `${JSON.stringify(scan, null, 2)}\n`, 'utf8');
  return { outPath, written: true, scan };
}

function toPackageArtefact(row: NewPackageRow): NewPackageArtefact {
  return {
    kind: 'new_package',
    package: row.name,
    identifier: row.name,
    source_path: `${row.packagePath}/package.json`,
  };
}

function toExportArtefact(row: NewExportRow): NewExportArtefact {
  return {
    kind: 'new_export',
    package: row.packageName,
    identifier: row.identifier,
    source_path: `${row.packagePath}/src/index.ts`,
    decl_kind: row.decl_kind,
    isTypeOnly: row.isTypeOnly,
  };
}

function summarize(artefacts: readonly ArtefactRow[]): ScanFile['summary'] {
  let pkg = 0;
  let exp = 0;
  let ext = 0;
  for (const a of artefacts) {
    if (a.kind === 'new_package') pkg += 1;
    else if (a.kind === 'new_export') exp += 1;
    else if (a.kind === 'new_external_agent') ext += 1;
  }
  return {
    artefact_count: artefacts.length,
    new_package_count: pkg,
    new_export_count: exp,
    new_external_agent_count: ext,
  };
}

function defaultOutDir(sha: string): string {
  return path.join(homedir(), '.caia', 'post-merge', 'work', sha);
}

function readPackageName(pkgJsonAbs: string): string | null {
  try {
    const raw = readFileSync(pkgJsonAbs, 'utf8');
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === 'string' && parsed.name.length > 0 ? parsed.name : null;
  } catch {
    return null;
  }
}

function defaultRunGh(pr: number): GhPrViewResult {
  const out = execFileSync(
    'gh',
    ['pr', 'view', String(pr), '--json', 'files,mergeCommit'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const parsed = JSON.parse(out) as unknown;
  if (!isGhPrViewResult(parsed)) {
    throw new Error(
      `gh pr view returned unexpected shape for PR ${pr}: ${out.slice(0, 200)}`,
    );
  }
  return parsed;
}

function isGhPrViewResult(value: unknown): value is GhPrViewResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { files?: unknown };
  if (!Array.isArray(v.files)) return false;
  if (!v.files.every(isGhPrFile)) return false;
  return true;
}

function isGhPrFile(value: unknown): value is GhPrFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<GhPrFile>;
  return (
    typeof v.path === 'string' &&
    typeof v.changeType === 'string' &&
    typeof v.additions === 'number' &&
    typeof v.deletions === 'number'
  );
}

// ---------------------------------------------------------------------------
// CLI plumbing
// ---------------------------------------------------------------------------

const HELP = `caia-adoption-run scan — detect new artefacts from a merged PR.

Usage:
  caia-adoption-run scan --pr <num> [options]

Required:
  --pr <num>                PR number to scan.

Options:
  --sha <sha>               Merge commit SHA. Default: looked up via \`gh pr view\`.
  --out <dir>               Output directory. Default: ~/.caia/post-merge/work/<sha>/.
  --repo <dir>              Repository root the gh paths resolve against. Default: cwd.
  --force                   Regenerate scan.json even if it already exists.
  -h, --help                Show this help.

Output: <out>/scan.json — { version, sha, pr, generated_at, artefacts[], summary }.
Idempotent: re-running with an existing scan.json is a no-op unless --force.
`;

interface ParsedScanArgs {
  help: boolean;
  pr: number | null;
  sha: string | null;
  outDir: string | null;
  repoRoot: string | null;
  force: boolean;
  error: string | null;
}

function parseScanArgs(argv: ReadonlyArray<string>): ParsedScanArgs {
  const out: ParsedScanArgs = {
    help: false,
    pr: null,
    sha: null,
    outDir: null,
    repoRoot: null,
    force: false,
    error: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '-h':
      case '--help':
        out.help = true;
        return out;
      case '--pr': {
        if (next === undefined) { out.error = '--pr requires a value'; return out; }
        const n = Number.parseInt(next, 10);
        if (!Number.isFinite(n) || n <= 0) {
          out.error = `--pr: invalid number "${next}"`;
          return out;
        }
        out.pr = n;
        i += 1;
        break;
      }
      case '--sha':
        if (next === undefined) { out.error = '--sha requires a value'; return out; }
        out.sha = next;
        i += 1;
        break;
      case '--out':
        if (next === undefined) { out.error = '--out requires a value'; return out; }
        out.outDir = next;
        i += 1;
        break;
      case '--repo':
        if (next === undefined) { out.error = '--repo requires a value'; return out; }
        out.repoRoot = next;
        i += 1;
        break;
      case '--force':
        out.force = true;
        break;
      default:
        out.error = `unknown arg: ${arg}`;
        return out;
    }
  }
  return out;
}

export function runScanCli(argv: ReadonlyArray<string>): CliResult {
  const args = parseScanArgs(argv);
  if (args.help) {
    return { exitCode: 0, stdout: HELP, stderr: '' };
  }
  if (args.error) {
    return { exitCode: 2, stdout: '', stderr: `${args.error}\n\n${HELP}` };
  }
  if (args.pr === null) {
    return { exitCode: 2, stdout: '', stderr: `--pr is required\n\n${HELP}` };
  }

  try {
    const opts: ScanOptions = {
      pr: args.pr,
      force: args.force,
      ...(args.sha ? { sha: args.sha } : {}),
      ...(args.outDir ? { outDir: args.outDir } : {}),
      ...(args.repoRoot ? { repoRoot: args.repoRoot } : {}),
    };
    const result = runScan(opts);
    const action = result.written ? 'wrote' : 'skipped (already present)';
    const { artefact_count, new_package_count, new_export_count, new_external_agent_count } =
      result.scan.summary;
    const stdout =
      `scan: ${action} ${result.outPath}\n` +
      `  artefacts=${artefact_count} new_packages=${new_package_count} ` +
      `new_exports=${new_export_count} new_external_agents=${new_external_agent_count}\n`;
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: '', stderr: `scan: ${msg}\n` };
  }
}
