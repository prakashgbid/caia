// L1 literal-pattern cross-reference for adoption enforcement.
//
// Given a single artefact row (e.g. a new export from a merged PR), search
// the caia tree with `git grep -n -F` for occurrences of its identifier and
// return adoption-candidate sites that survive the noise filters.
//
// Companion design: agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md (§5).

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ArtefactKind = 'new_export' | 'new_package' | 'new_external_agent';

export interface ArtefactRow {
  /** The artefact taxonomy (extensible — unknown kinds are processed identically). */
  kind: ArtefactKind | string;
  /** Source package owning the artefact. Short ("guardrails-validator") or scoped ("@chiefaia/guardrails-validator"). */
  package: string;
  /** Identifier to look up, e.g. "scanPii", "Tracer", "generateCaiaPrimer". */
  identifier: string;
  /** Optional repo-relative path that produced this artefact (used to identify the artefact's "own dir"). */
  source_path?: string;
}

export type LiteralConfidence = 'literal';

export interface LiteralCandidate {
  /** Repo-relative path of the matching file. */
  file: string;
  /** 1-based line number in the matching file. */
  line: number;
  /** Verbatim source line that matched. */
  match: string;
  confidence: LiteralConfidence;
  reason: string;
}

export interface LiteralPatternOptions {
  /** Absolute path to the repository working tree. */
  repoRoot: string;
  /**
   * Identifiers below this length are skipped unless allow-listed via the
   * overrides YAML. Default is 6 (INT.1.A4 used 5; the substrate design
   * bumped this to 6 for PR-generation precision).
   */
  minLength?: number;
  /** Optional override of the stopword set (lowercase). */
  stopwords?: Set<string>;
  /** Path to identifier-overrides YAML. Default `<repoRoot>/.adoption/identifier-overrides.yaml`. */
  overridesPath?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Stopword list mirrored verbatim from scripts/reuse-check.js (INT.1.A4 — Guardrail #9).
// Update audit:
//   mirrored 2026-05-16 against scripts/reuse-check.js @develop SHA 8faabe2.
const REUSE_CHECK_STOPWORDS: ReadonlyArray<string> = [
  'main', 'init', 'index', 'config', 'setup', 'test', 'tests',
  'mock', 'mocks', 'util', 'utils', 'helper', 'helpers', 'lib',
  'data', 'value', 'values', 'result', 'results', 'state', 'status',
  'options', 'option', 'props', 'params', 'param', 'args', 'arg',
  'item', 'items', 'name', 'type', 'types', 'kind', 'mode',
  'context', 'request', 'response', 'error', 'err', 'success',
  'default', 'callback', 'handler', 'listener', 'event',
  'create', 'build', 'make', 'parse', 'format', 'load', 'save',
  'read', 'write', 'open', 'close', 'start', 'stop', 'run',
];

const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set(
  REUSE_CHECK_STOPWORDS.map((w) => w.toLowerCase()),
);

// Directory segments to drop; matched as full path segments (split on "/").
const EXCLUDED_DIR_SEGMENTS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
]);

// Path prefixes (relative to repo root) that are always excluded.
// `.adoption/` holds the substrate's own config (overrides, ledger) and never
// represents an adoption *site*.
const EXCLUDED_PATH_PREFIXES: ReadonlyArray<string> = [
  '.claude/worktrees/',
  '.adoption/',
];

// Lock-file basenames to drop — huge noisy hits in dependency graphs.
const LOCK_FILE_BASENAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'go.sum',
  'composer.lock',
  'Pipfile.lock',
]);

const DEFAULT_MIN_LENGTH = 6;

const REASON_MATCH_OUTSIDE_OWN_PACKAGE =
  'identifier match outside its own package';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function findLiteralCandidates(
  artefact: ArtefactRow,
  opts: LiteralPatternOptions,
): LiteralCandidate[] {
  const identifier = (artefact?.identifier ?? '').trim();
  if (!identifier) return [];

  const repoRoot = opts.repoRoot;
  const minLength = opts.minLength ?? DEFAULT_MIN_LENGTH;
  const stopwords = opts.stopwords ?? DEFAULT_STOPWORDS;
  const overridesPath = opts.overridesPath ?? path.join(repoRoot, '.adoption', 'identifier-overrides.yaml');
  const overrides = loadIdentifierOverrides(overridesPath);

  // Overrides bypass the min-length cutoff. Stopwords always apply.
  if (identifier.length < minLength && !overrides.has(identifier)) {
    return [];
  }

  if (stopwords.has(identifier.toLowerCase())) {
    return [];
  }

  const ownDir = artefactOwnDir(artefact);
  const rawHits = runGitGrep(identifier, repoRoot);
  return filterHits(rawHits, ownDir);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface RawHit {
  file: string;
  line: number;
  content: string;
}

function runGitGrep(identifier: string, repoRoot: string): RawHit[] {
  // -F: literal (no regex meta), -n: line numbers, -I: skip binaries.
  // "--": end of options so identifiers like `-foo` are safe.
  let stdout: string;
  try {
    stdout = execFileSync(
      'git',
      ['grep', '-n', '-I', '-F', '--', identifier],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (err) {
    // `git grep` exits 1 when there are no matches — not an error for us.
    const e = err as NodeJS.ErrnoException & { status?: number };
    if (e && (e.status === 1 || (e as unknown as { code?: number }).code === 1)) {
      return [];
    }
    throw err;
  }

  const out: RawHit[] = [];
  for (const raw of stdout.split('\n')) {
    if (!raw) continue;
    // Format: <path>:<line>:<content>. Path may contain ":" so split on the first two ":" only.
    const firstColon = raw.indexOf(':');
    if (firstColon < 0) continue;
    const secondColon = raw.indexOf(':', firstColon + 1);
    if (secondColon < 0) continue;
    const file = raw.slice(0, firstColon);
    const lineStr = raw.slice(firstColon + 1, secondColon);
    const content = raw.slice(secondColon + 1);
    const line = Number.parseInt(lineStr, 10);
    if (!Number.isFinite(line)) continue;
    out.push({ file, line, content });
  }
  return out;
}

function filterHits(hits: ReadonlyArray<RawHit>, ownDir: string | null): LiteralCandidate[] {
  const candidates: LiteralCandidate[] = [];
  for (const hit of hits) {
    if (ownDir && (hit.file === ownDir || hit.file.startsWith(ownDir + '/'))) {
      continue;
    }
    if (isExcludedPath(hit.file)) continue;
    if (LOCK_FILE_BASENAMES.has(path.basename(hit.file))) continue;

    candidates.push({
      file: hit.file,
      line: hit.line,
      match: hit.content,
      confidence: 'literal',
      reason: REASON_MATCH_OUTSIDE_OWN_PACKAGE,
    });
  }
  return candidates;
}

function isExcludedPath(file: string): boolean {
  for (const seg of file.split('/')) {
    if (EXCLUDED_DIR_SEGMENTS.has(seg)) return true;
  }
  for (const prefix of EXCLUDED_PATH_PREFIXES) {
    if (file.startsWith(prefix)) return true;
  }
  return false;
}

// "Own dir" identifies the package directory the artefact came from, so
// hits inside that directory are dropped (we're not interested in the artefact
// referencing itself). Conventions:
//   - artefact.source_path, if given and prefixed with a known monorepo root, wins.
//   - otherwise we assume `packages/<short-name>` (stripping any `@scope/` prefix).
function artefactOwnDir(artefact: ArtefactRow): string | null {
  const sp = artefact.source_path?.trim();
  if (sp && /^(?:packages|apps|services|infrastructure|infra)\//.test(sp)) {
    const parts = sp.split('/');
    const head = parts[0];
    const second = parts[1];
    if (head && second) return `${head}/${second}`;
  }
  const pkg = (artefact.package ?? '').trim();
  if (!pkg) return null;
  const shortName = pkg.startsWith('@') ? pkg.split('/').slice(1).join('/') : pkg;
  if (!shortName) return null;
  return `packages/${shortName}`;
}

// ---------------------------------------------------------------------------
// Identifier-overrides loader
//   Schema: { identifiers: ['shortName1', 'shortName2', ...] }
// ---------------------------------------------------------------------------

function loadIdentifierOverrides(file: string): Set<string> {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return new Set();
  }
  return parseIdentifierOverrides(text);
}

// Minimal YAML reader for the override file's narrow schema. Accepts both:
//
//   identifiers: ['a', "b", c]
//   identifiers:
//     - a
//     - "b"
//     - 'c'
//
// Anything else falls through to an empty set — we deliberately don't pull
// in a YAML dependency for a single-key schema.
export function parseIdentifierOverrides(text: string): Set<string> {
  const out = new Set<string>();

  // Strip YAML comments (full-line and trailing) but preserve quoted hashes.
  const stripped = text
    .split('\n')
    .map((ln) => stripYamlComment(ln))
    .join('\n');

  // Inline flow form: `identifiers: [a, b]`
  const flow = /identifiers\s*:\s*\[([^\]]*)\]/.exec(stripped);
  if (flow && flow[1] !== undefined) {
    for (const raw of flow[1].split(',')) {
      const v = unquote(raw.trim());
      if (v) out.add(v);
    }
    return out;
  }

  // Block form: `identifiers:` then `  - a`
  let inList = false;
  for (const ln of stripped.split('\n')) {
    if (/^\s*identifiers\s*:\s*$/.test(ln)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    if (/^\S/.test(ln)) {
      // dedent → new top-level key boundary
      inList = false;
      continue;
    }
    const m = /^\s*-\s*(.*)$/.exec(ln);
    if (m && m[1] !== undefined) {
      const v = unquote(m[1].trim());
      if (v) out.add(v);
    }
  }
  return out;
}

function stripYamlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}
