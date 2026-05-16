// L1 cross-ref candidate scoring + per-artefact cap.
//
// score = uniqueness × frequency_weight
//
//   uniqueness         = 1 / max(1, # @chiefaia/* packages that export this identifier).
//                        A name exported in only one place is a stronger signal than a
//                        name exported in many places (collision-prone).
//   frequency_weight   = 1 / log2(2 + total git-grep hits across repo).
//                        Rarely-used identifiers score higher (less likely coincidental).
//
// Companion design: agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md (§5).
//
// The score is per-artefact (one identifier ⇒ one score). It is attached to every
// candidate so downstream consumers can sort artefacts by confidence without needing
// to recombine. `--max-candidates` then caps per-artefact fan-out (default 5).

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ArtefactRow, LiteralCandidate } from './literal-pattern.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScoredCandidate extends LiteralCandidate {
  /** Per-artefact score: uniqueness × frequencyWeight. Same value for every candidate of the artefact. */
  score: number;
}

export interface ArtefactScoring {
  uniqueness: number;
  frequencyWeight: number;
  score: number;
  exportingPackagesCount: number;
  totalHits: number;
}

export interface ScoreCandidatesResult {
  scoring: ArtefactScoring;
  /** Capped at maxCandidates. Sorted desc by score (stable; per-artefact ties preserve input order). */
  candidates: ScoredCandidate[];
  /** Count of candidates dropped by the cap (0 when uncapped or under-cap). */
  truncated: number;
}

export interface ScoreCandidatesOptions {
  /** Absolute path to the repository working tree. */
  repoRoot: string;
  /** Per-artefact cap on candidate count. Default 5. Pass Infinity / 0 to disable. */
  maxCandidates?: number;
  /** Scope used to filter workspace packages when counting exports. Default "@chiefaia". */
  packageScope?: string;
  /** Directories to scan for workspace packages. Default ["packages"]. */
  packagesDirs?: ReadonlyArray<string>;
  /** Test override: forced count of @scope/* packages exporting the identifier. */
  exportingPackagesCount?: number;
  /** Test override: forced total raw git-grep hit count for the identifier. */
  totalHits?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_CANDIDATES = 5;
export const DEFAULT_PACKAGE_SCOPE = '@chiefaia';
export const DEFAULT_PACKAGES_DIRS: ReadonlyArray<string> = ['packages'];

// ---------------------------------------------------------------------------
// Pure scoring math
// ---------------------------------------------------------------------------

export function computeUniqueness(exportingPackagesCount: number): number {
  const n = Math.max(1, Math.floor(exportingPackagesCount));
  return 1 / n;
}

export function computeFrequencyWeight(totalHits: number): number {
  const hits = Math.max(0, totalHits);
  return 1 / Math.log2(2 + hits);
}

export function computeScore(uniqueness: number, frequencyWeight: number): number {
  return uniqueness * frequencyWeight;
}

// ---------------------------------------------------------------------------
// Cap helper (exposed for unit-level coverage)
// ---------------------------------------------------------------------------

export function applyMaxCandidates<T extends { score: number }>(
  items: ReadonlyArray<T>,
  maxCandidates: number,
): { kept: T[]; truncated: number } {
  // Stable sort desc by score — Array.prototype.sort is stable in modern Node.
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const limit = !Number.isFinite(maxCandidates) || maxCandidates <= 0
    ? sorted.length
    : Math.floor(maxCandidates);
  if (sorted.length <= limit) return { kept: sorted, truncated: 0 };
  return { kept: sorted.slice(0, limit), truncated: sorted.length - limit };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function scoreCandidates(
  artefact: ArtefactRow,
  candidates: ReadonlyArray<LiteralCandidate>,
  opts: ScoreCandidatesOptions,
): ScoreCandidatesResult {
  const repoRoot = opts.repoRoot;
  const scope = opts.packageScope ?? DEFAULT_PACKAGE_SCOPE;
  const packagesDirs = opts.packagesDirs ?? DEFAULT_PACKAGES_DIRS;
  const max = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const identifier = (artefact?.identifier ?? '').trim();

  const exportingPackagesCount = opts.exportingPackagesCount ?? (
    identifier ? countExportingPackages(identifier, repoRoot, scope, packagesDirs) : 0
  );
  const totalHits = opts.totalHits ?? (
    identifier ? countTotalHits(identifier, repoRoot) : 0
  );

  const uniqueness = computeUniqueness(exportingPackagesCount);
  const frequencyWeight = computeFrequencyWeight(totalHits);
  const score = computeScore(uniqueness, frequencyWeight);

  const scored: ScoredCandidate[] = candidates.map((c) => ({ ...c, score }));
  const { kept, truncated } = applyMaxCandidates(scored, max);

  return {
    scoring: {
      uniqueness,
      frequencyWeight,
      score,
      exportingPackagesCount,
      totalHits,
    },
    candidates: kept,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Frequency: total raw git-grep hits across the repo (no filtering)
// ---------------------------------------------------------------------------

export function countTotalHits(identifier: string, repoRoot: string): number {
  if (!identifier) return 0;
  // -c emits "<file>:<count>" for each file that has at least one match. Sum the counts.
  let stdout: string;
  try {
    stdout = execFileSync(
      'git',
      ['grep', '-c', '-I', '-F', '--', identifier],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number };
    if (e && (e.status === 1 || (e as unknown as { code?: number }).code === 1)) {
      return 0;
    }
    throw err;
  }

  let total = 0;
  for (const raw of stdout.split('\n')) {
    if (!raw) continue;
    const colon = raw.lastIndexOf(':');
    if (colon < 0) continue;
    const n = Number.parseInt(raw.slice(colon + 1), 10);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Uniqueness: count @scope/* packages whose source exports the identifier
// ---------------------------------------------------------------------------

// Matches `export function|class|interface|type|enum|const|let|var|async function` followed by the identifier.
// Also accepts `export default function|class` followed by the identifier. Word-boundary anchored.
function exportRegexFor(identifier: string): RegExp {
  const id = escapeRegex(identifier);
  return new RegExp(
    [
      // export <kind> <id>
      `^\\s*export\\s+(?:async\\s+)?(?:function|class|interface|type|enum|const|let|var)\\s+${id}\\b`,
      // export default function|class <id>
      `^\\s*export\\s+default\\s+(?:async\\s+)?(?:function|class)\\s+${id}\\b`,
      // export { ..., id, ... } [from '...']
      `^\\s*export\\s*\\{[^}]*\\b${id}\\b[^}]*\\}`,
    ].join('|'),
    'm',
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countExportingPackages(
  identifier: string,
  repoRoot: string,
  scope: string = DEFAULT_PACKAGE_SCOPE,
  packagesDirs: ReadonlyArray<string> = DEFAULT_PACKAGES_DIRS,
): number {
  if (!identifier) return 0;
  const re = exportRegexFor(identifier);
  let count = 0;

  for (const sub of packagesDirs) {
    const root = path.join(repoRoot, sub);
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      const pkgDir = path.join(root, name);
      const pkgJson = path.join(pkgDir, 'package.json');
      let manifest: { name?: string };
      try {
        manifest = JSON.parse(fs.readFileSync(pkgJson, 'utf8')) as { name?: string };
      } catch {
        continue;
      }
      if (!manifest.name) continue;
      if (scope && !manifest.name.startsWith(scope + '/')) continue;
      if (packageExportsIdentifier(pkgDir, re)) count++;
    }
  }
  return count;
}

function packageExportsIdentifier(pkgDir: string, re: RegExp): boolean {
  const srcDir = path.join(pkgDir, 'src');
  // Walk pkgDir/src/**/*.ts (no node_modules, dist, build). Fallback to pkgDir
  // when src/ is absent (some workspaces keep entry at root).
  const root = fs.existsSync(srcDir) ? srcDir : pkgDir;
  return walkMatch(root, re);
}

function walkMatch(dir: string, re: RegExp): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const ent of entries) {
    const name = ent.name;
    if (ent.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'build' || name === '.next') continue;
      if (walkMatch(path.join(dir, name), re)) return true;
      continue;
    }
    if (!ent.isFile()) continue;
    if (!/\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(name)) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      continue;
    }
    if (re.test(text)) return true;
  }
  return false;
}
