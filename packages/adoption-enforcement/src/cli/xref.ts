// `caia-adoption-run xref` — read scan.json, run L1 cross-ref + scoring per
// artefact, write xref.json beside scan.json.
//
// Wired into the post-merge pipeline (phase 4); also invocable on demand for
// historical PRs or test fixtures.
//
// Companion design: agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md (§2.3, §5).

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  type ArtefactRow,
  findLiteralCandidates,
} from '../crossref/literal-pattern.js';
import {
  type ArtefactScoring,
  type ScoredCandidate,
  DEFAULT_MAX_CANDIDATES,
  DEFAULT_PACKAGE_SCOPE,
  DEFAULT_PACKAGES_DIRS,
  scoreCandidates,
} from '../crossref/score.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface XrefOptions {
  /** Work directory containing scan.json; xref.json is written here. */
  workDir: string;
  /** Repository root to scan against. Default: process.cwd(). */
  repoRoot?: string;
  /** Regenerate even if xref.json already exists. Default false. */
  force?: boolean;
  /** Per-artefact candidate cap. Default 5. Pass 0 / Infinity to disable. */
  maxCandidates?: number;
  /** Workspace-package scope. Default "@chiefaia". */
  packageScope?: string;
  /** Sub-directories searched for workspace packages. Default ["packages"]. */
  packagesDirs?: ReadonlyArray<string>;
  /** Identifier min-length cutoff. Default 6 (matches literal-pattern default). */
  minLength?: number;
  /** Override of the identifier-overrides YAML path (defaults to <repoRoot>/.adoption/identifier-overrides.yaml). */
  overridesPath?: string;
}

export interface ArtefactXref {
  /** Echo of the artefact row from scan.json. */
  artefact: ArtefactRow;
  scoring: ArtefactScoring;
  candidates: ScoredCandidate[];
  /** Candidates dropped by the per-artefact cap. */
  truncated: number;
}

export interface XrefReport {
  version: 1;
  /** Originating commit, if scan.json supplied one. */
  sha: string | null;
  generated_at: string;
  options: {
    repoRoot: string;
    maxCandidates: number;
    packageScope: string;
    packagesDirs: ReadonlyArray<string>;
    minLength: number;
  };
  artefacts: ArtefactXref[];
  summary: {
    artefact_count: number;
    candidate_count: number;
    truncated_total: number;
  };
}

export interface RunXrefResult {
  /** Absolute path to xref.json. */
  outPath: string;
  /** True when xref.json was newly written; false when skipped (idempotent). */
  written: boolean;
  /** Loaded or freshly-computed report. */
  report: XrefReport;
}

// ---------------------------------------------------------------------------
// scan.json parsing — accept a few shapes so we are robust to upstream churn
// ---------------------------------------------------------------------------

interface ScanFile {
  sha: string | null;
  artefacts: ArtefactRow[];
}

function parseScanFile(raw: unknown): ScanFile {
  if (Array.isArray(raw)) {
    return { sha: null, artefacts: raw.map(coerceArtefact).filter(isArtefact) };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const sha = typeof obj.sha === 'string' ? obj.sha : null;
    const list = (obj.artefacts ?? obj.rows ?? obj.items);
    if (Array.isArray(list)) {
      return { sha, artefacts: list.map(coerceArtefact).filter(isArtefact) };
    }
  }
  throw new Error(
    'scan.json: expected an array of artefact rows or an object with an "artefacts" array',
  );
}

function coerceArtefact(row: unknown): ArtefactRow | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const kind = typeof r.kind === 'string' ? r.kind : '';
  const pkg = typeof r.package === 'string' ? r.package : '';
  const identifier = typeof r.identifier === 'string' ? r.identifier : '';
  if (!identifier || !pkg) return null;
  // `file` is the design-doc shape; `source_path` is what literal-pattern.ts reads.
  const sourcePath = typeof r.source_path === 'string'
    ? r.source_path
    : (typeof r.file === 'string' ? r.file : undefined);
  return {
    kind: kind || 'new_export',
    package: pkg,
    identifier,
    ...(sourcePath ? { source_path: sourcePath } : {}),
  };
}

function isArtefact(r: ArtefactRow | null): r is ArtefactRow {
  return r !== null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runXref(opts: XrefOptions): RunXrefResult {
  const workDir = path.resolve(opts.workDir);
  if (!fs.existsSync(workDir) || !fs.statSync(workDir).isDirectory()) {
    throw new Error(`xref: --work-dir is not a directory: ${workDir}`);
  }

  const scanPath = path.join(workDir, 'scan.json');
  const outPath = path.join(workDir, 'xref.json');

  if (!opts.force && fs.existsSync(outPath)) {
    const existingRaw = fs.readFileSync(outPath, 'utf8');
    const existing = JSON.parse(existingRaw) as XrefReport;
    return { outPath, written: false, report: existing };
  }

  if (!fs.existsSync(scanPath)) {
    throw new Error(`xref: scan.json not found at ${scanPath}`);
  }

  const scanRaw = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
  const scan = parseScanFile(scanRaw);

  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const maxCandidates = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const packageScope = opts.packageScope ?? DEFAULT_PACKAGE_SCOPE;
  const packagesDirs = opts.packagesDirs ?? DEFAULT_PACKAGES_DIRS;
  const minLength = opts.minLength ?? 6;

  const artefacts: ArtefactXref[] = [];
  let candidateTotal = 0;
  let truncatedTotal = 0;

  for (const row of scan.artefacts) {
    const literal = findLiteralCandidates(row, {
      repoRoot,
      minLength,
      ...(opts.overridesPath ? { overridesPath: opts.overridesPath } : {}),
    });
    const scored = scoreCandidates(row, literal, {
      repoRoot,
      maxCandidates,
      packageScope,
      packagesDirs,
    });
    artefacts.push({
      artefact: row,
      scoring: scored.scoring,
      candidates: scored.candidates,
      truncated: scored.truncated,
    });
    candidateTotal += scored.candidates.length;
    truncatedTotal += scored.truncated;
  }

  const report: XrefReport = {
    version: 1,
    sha: scan.sha,
    generated_at: new Date().toISOString(),
    options: {
      repoRoot,
      maxCandidates,
      packageScope,
      packagesDirs,
      minLength,
    },
    artefacts,
    summary: {
      artefact_count: artefacts.length,
      candidate_count: candidateTotal,
      truncated_total: truncatedTotal,
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return { outPath, written: true, report };
}

// ---------------------------------------------------------------------------
// CLI plumbing (used by bin/caia-adoption-run.mjs)
// ---------------------------------------------------------------------------

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const HELP = `caia-adoption-run xref — L1 cross-reference for adoption candidates.

Usage:
  caia-adoption-run xref --work-dir <dir> [options]

Required:
  --work-dir <dir>          Directory containing scan.json; xref.json is written here.

Options:
  --repo <dir>              Repository root to search. Default: cwd.
  --force                   Regenerate xref.json even if it exists.
  --max-candidates <n>      Per-artefact candidate cap. Default: 5. 0 disables.
  --scope <name>            Workspace package scope. Default: @chiefaia.
  --min-length <n>          Identifier min-length cutoff. Default: 6.
  --overrides <path>        Identifier-overrides YAML path. Default: <repo>/.adoption/identifier-overrides.yaml.
  -h, --help                Show this help.
`;

interface ParsedArgs {
  help: boolean;
  workDir: string | null;
  repoRoot: string | null;
  force: boolean;
  maxCandidates: number | null;
  packageScope: string | null;
  minLength: number | null;
  overridesPath: string | null;
  error: string | null;
}

function parseXrefArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const out: ParsedArgs = {
    help: false,
    workDir: null,
    repoRoot: null,
    force: false,
    maxCandidates: null,
    packageScope: null,
    minLength: null,
    overridesPath: null,
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
      case '--work-dir':
        if (next === undefined) { out.error = '--work-dir requires a value'; return out; }
        out.workDir = next;
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
      case '--max-candidates': {
        if (next === undefined) { out.error = '--max-candidates requires a value'; return out; }
        const n = Number.parseInt(next, 10);
        if (!Number.isFinite(n) || n < 0) { out.error = `--max-candidates: invalid number "${next}"`; return out; }
        out.maxCandidates = n;
        i += 1;
        break;
      }
      case '--scope':
        if (next === undefined) { out.error = '--scope requires a value'; return out; }
        out.packageScope = next;
        i += 1;
        break;
      case '--min-length': {
        if (next === undefined) { out.error = '--min-length requires a value'; return out; }
        const n = Number.parseInt(next, 10);
        if (!Number.isFinite(n) || n < 1) { out.error = `--min-length: invalid number "${next}"`; return out; }
        out.minLength = n;
        i += 1;
        break;
      }
      case '--overrides':
        if (next === undefined) { out.error = '--overrides requires a value'; return out; }
        out.overridesPath = next;
        i += 1;
        break;
      default:
        out.error = `unknown arg: ${arg}`;
        return out;
    }
  }
  return out;
}

export function runXrefCli(argv: ReadonlyArray<string>): CliResult {
  const args = parseXrefArgs(argv);
  if (args.help) {
    return { exitCode: 0, stdout: HELP, stderr: '' };
  }
  if (args.error) {
    return { exitCode: 2, stdout: '', stderr: `${args.error}\n\n${HELP}` };
  }
  if (!args.workDir) {
    return { exitCode: 2, stdout: '', stderr: `--work-dir is required\n\n${HELP}` };
  }

  try {
    const opts: XrefOptions = {
      workDir: args.workDir,
      force: args.force,
      ...(args.repoRoot ? { repoRoot: args.repoRoot } : {}),
      ...(args.maxCandidates !== null ? { maxCandidates: args.maxCandidates } : {}),
      ...(args.packageScope ? { packageScope: args.packageScope } : {}),
      ...(args.minLength !== null ? { minLength: args.minLength } : {}),
      ...(args.overridesPath ? { overridesPath: args.overridesPath } : {}),
    };
    const result = runXref(opts);
    const action = result.written ? 'wrote' : 'skipped (already present)';
    const { artefact_count, candidate_count, truncated_total } = result.report.summary;
    const stdout =
      `xref: ${action} ${result.outPath}\n` +
      `  artefacts=${artefact_count} candidates=${candidate_count} truncated=${truncated_total}\n`;
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: '', stderr: `xref: ${msg}\n` };
  }
}
