/**
 * Drizzle migration breakpoint linter.
 *
 * Scans a Drizzle migrations directory (containing `*.sql` files plus a
 * `meta/_journal.json` manifest). For each migration file, lightly
 * tokenises the SQL to count top-level statements and compares against
 * the count of `--> statement-breakpoint` markers. If a file has more
 * than one top-level statement AND fewer breakpoint markers than the
 * gap between statements, emits a `block`-severity finding.
 *
 * The Drizzle SQL runner splits each migration on `--> statement-breakpoint`
 * and executes the chunks as separate prepared statements. When the marker
 * is missing, the runner tries to execute multi-statement SQL through a
 * driver that rejects it (sqlite: stops at first `;`; postgres: usually
 * works but tooling like better-sqlite3 throws). Either way, the migration
 * fails to apply on a clean DB and orchestrator boot breaks. PR #287 was
 * the most recent occurrence (2026-05-04); this linter is the permanent
 * guard.
 *
 * The tokeniser respects:
 *   - `--` line comments (to end of line)
 *   - `/* ... *\/` block comments (non-nestable; matches sqlite + most psql)
 *   - `'...'` string literals with `''` embedded escape
 *   - `"..."` quoted identifiers with `""` embedded escape
 *   - `` `...` `` MySQL-style identifiers
 *   - `[...]` SQL Server / Drizzle bracket identifiers
 *   - `$tag$...$tag$` Postgres dollar-quoted bodies (defensive — current
 *     dialect is sqlite but other packages may have their own migration
 *     dirs in pg later)
 *   - parenthesis nesting (only counts `;` at depth 0)
 *
 * Reference:
 *   - architecture doc §3.1
 *   - PR #287 (the regression that motivated this)
 *   - drizzle-orm sql migration runner format
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Finding } from './types.js';

/** Top-level statement count derived from a tokenised SQL file. */
export interface ParsedSqlFile {
  /** Number of top-level statements (trailing `;` outside strings/comments). */
  statementCount: number;
  /** Number of `--> statement-breakpoint` markers in the file. */
  breakpointCount: number;
  /** 1-based line numbers where breakpoint markers appear. */
  breakpointLines: number[];
  /** 1-based line numbers where top-level `;` appears. */
  statementEndLines: number[];
}

/**
 * Parse a SQL file. Tokeniser ignores everything inside comments and
 * string/identifier/dollar-quote bodies; counts only depth-0 semicolons.
 */
export function parseSql(source: string): ParsedSqlFile {
  let i = 0;
  const n = source.length;
  let depth = 0;
  let line = 1;
  const statementEndLines: number[] = [];

  // We deliberately *don't* track breakpoints in the same pass — they live
  // inside `--` comments so the tokenizer skips over them. We do a separate
  // line-based pass for breakpoints below.

  while (i < n) {
    const c = source[i];
    const c2 = i + 1 < n ? source[i + 1] : '';

    // Newline tracking.
    if (c === '\n') {
      line++;
      i++;
      continue;
    }

    // Line comment: -- ... \n
    if (c === '-' && c2 === '-') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }

    // Block comment: /* ... */  (non-nestable for sqlite/most psql)
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n - 1 && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++;
        i++;
      }
      i += 2; // consume closing */
      continue;
    }

    // Single-quoted string with '' escape.
    if (c === "'") {
      i++;
      while (i < n) {
        if (source[i] === "'" && source[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (source[i] === "'") {
          i++;
          break;
        }
        if (source[i] === '\n') line++;
        i++;
      }
      continue;
    }

    // Double-quoted identifier with "" escape.
    if (c === '"') {
      i++;
      while (i < n) {
        if (source[i] === '"' && source[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (source[i] === '"') {
          i++;
          break;
        }
        if (source[i] === '\n') line++;
        i++;
      }
      continue;
    }

    // Backtick identifier (MySQL).
    if (c === '`') {
      i++;
      while (i < n && source[i] !== '`') {
        if (source[i] === '\n') line++;
        i++;
      }
      i++;
      continue;
    }

    // Bracket identifier [foo].
    if (c === '[') {
      i++;
      while (i < n && source[i] !== ']') {
        if (source[i] === '\n') line++;
        i++;
      }
      i++;
      continue;
    }

    // Dollar-quoted body $tag$...$tag$ (PostgreSQL function bodies).
    if (c === '$') {
      // tag is [A-Za-z0-9_]* terminated by another $
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(source[j] ?? '')) j++;
      if (j < n && source[j] === '$') {
        const tag = source.slice(i, j + 1); // includes both $s
        i = j + 1;
        const closeIdx = source.indexOf(tag, i);
        if (closeIdx < 0) {
          // unterminated — bail, treat rest as opaque
          i = n;
          continue;
        }
        // count newlines between i and closeIdx for line tracking
        for (let k = i; k < closeIdx; k++) if (source[k] === '\n') line++;
        i = closeIdx + tag.length;
        continue;
      }
      // not a dollar-quote, fall through
    }

    // Parenthesis nesting (defensive — keeps us from counting CASE/CTE
    // internal semicolons that don't actually appear in valid SQL but
    // could appear in malformed input).
    if (c === '(') {
      depth++;
      i++;
      continue;
    }
    if (c === ')') {
      if (depth > 0) depth--;
      i++;
      continue;
    }

    // The thing we actually care about: top-level statement terminator.
    if (c === ';' && depth === 0) {
      statementEndLines.push(line);
      i++;
      continue;
    }

    i++;
  }

  // Breakpoint pass: count Drizzle markers. They're inside `--` comments
  // so the SQL tokenizer skipped them. Drizzle's runner splits on the
  // literal substring `--> statement-breakpoint` regardless of position
  // — the marker can appear on its own line OR inline at the end of a
  // statement (e.g. `CREATE INDEX foo;--> statement-breakpoint`). Count
  // every occurrence; line numbers point at the line containing the
  // first occurrence on that line (rare for >1 per line but possible).
  const breakpointLines: number[] = [];
  const lines = source.split('\n');
  const markerRe = /-->\s*statement-breakpoint/gi;
  for (let k = 0; k < lines.length; k++) {
    const ln = lines[k] ?? '';
    const matches = ln.match(markerRe);
    if (matches) {
      for (let m = 0; m < matches.length; m++) {
        breakpointLines.push(k + 1);
      }
    }
  }

  return {
    statementCount: statementEndLines.length,
    breakpointCount: breakpointLines.length,
    breakpointLines,
    statementEndLines,
  };
}

/** Drizzle journal entry shape (subset we care about). */
export interface JournalEntry {
  idx: number;
  tag: string;
  breakpoints: boolean;
  when?: number;
  version?: string;
}

export interface JournalFile {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/** Read + parse the Drizzle journal; returns null on missing/invalid. */
export async function loadJournal(metaDir: string): Promise<JournalFile | null> {
  const p = path.join(metaDir, '_journal.json');
  try {
    const raw = await fs.readFile(p, 'utf8');
    const j = JSON.parse(raw);
    if (j && Array.isArray(j.entries)) return j as JournalFile;
    return null;
  } catch {
    return null;
  }
}

export interface LintMigrationsOptions {
  /** Absolute path to a Drizzle migrations directory. Must contain `meta/_journal.json`. */
  migrationsDir: string;
  /** Restrict scan to these basenames (e.g. `['0052_smart_cicd_observations.sql']`). When omitted, scans all `*.sql`. */
  onlyBasenames?: string[];
}

/**
 * Lint every `.sql` file in a Drizzle migrations dir.
 *
 * A finding is emitted when:
 *   - the file has > 1 top-level statement, AND
 *   - the file has fewer `--> statement-breakpoint` markers than
 *     `statementCount - 1` (i.e. at least one statement boundary
 *     is missing the marker).
 *
 * The journal `breakpoints` flag is reported in the finding context for
 * dashboard visibility but is NOT used as the trigger — historically some
 * journals have `breakpoints: false` for files that should still have
 * markers.
 */
export async function lintMigrations(opts: LintMigrationsOptions): Promise<Finding[]> {
  const findings: Finding[] = [];
  const migrationsDir = opts.migrationsDir;
  const metaDir = path.join(migrationsDir, 'meta');
  const journal = await loadJournal(metaDir);
  const journalByTag = new Map<string, JournalEntry>();
  if (journal) {
    for (const e of journal.entries) journalByTag.set(e.tag, e);
  }

  let entries: string[];
  try {
    entries = await fs.readdir(migrationsDir);
  } catch (err) {
    return [
      {
        analyzer: 'migration-linter',
        ruleId: 'migrations-dir-unreadable',
        path: migrationsDir,
        severity: 'block',
        message: `Cannot read migrations directory: ${(err as Error).message}`,
        remediation: 'Verify the directory exists and is readable.',
      },
    ];
  }

  for (const entry of entries.sort()) {
    if (!entry.endsWith('.sql')) continue;
    if (opts.onlyBasenames && !opts.onlyBasenames.includes(entry)) continue;
    const full = path.join(migrationsDir, entry);
    const tag = entry.replace(/\.sql$/, '');
    const journalEntry = journalByTag.get(tag);
    let source: string;
    try {
      source = await fs.readFile(full, 'utf8');
    } catch (err) {
      findings.push({
        analyzer: 'migration-linter',
        ruleId: 'sql-unreadable',
        path: path.relative(process.cwd(), full),
        severity: 'block',
        message: `Cannot read migration: ${(err as Error).message}`,
      });
      continue;
    }

    const parsed = parseSql(source);
    if (parsed.statementCount > 1 && parsed.breakpointCount < parsed.statementCount - 1) {
      findings.push({
        analyzer: 'migration-linter',
        ruleId: 'multi-statement-without-breakpoint',
        path: path.relative(process.cwd(), full),
        line: parsed.statementEndLines[0] ?? 1,
        severity: 'block',
        message: `Migration has ${parsed.statementCount} top-level statements but only ${parsed.breakpointCount} \`--> statement-breakpoint\` markers (need at least ${parsed.statementCount - 1}). The Drizzle SQL runner will fail to apply this migration on a clean DB.`,
        remediation:
          'Insert `--> statement-breakpoint` between each pair of statements. See PR #287 (`fix(orchestrator-migration): add Drizzle statement-breakpoints to 0052_smart_cicd_observations`) for the canonical fix shape.',
        context: {
          statementCount: parsed.statementCount,
          breakpointCount: parsed.breakpointCount,
          journalBreakpointsFlag: journalEntry?.breakpoints ?? null,
          statementEndLines: parsed.statementEndLines,
        },
      });
    }
  }

  return findings;
}

/**
 * Convenience: discover Drizzle migration roots under a repo root.
 * A directory counts as a migration root if it contains `meta/_journal.json`.
 */
export async function discoverMigrationRoots(repoRoot: string): Promise<string[]> {
  const roots: string[] = [];
  const candidates = [
    path.join(repoRoot, 'apps/orchestrator/src/db/migrations'),
    path.join(repoRoot, 'packages/spend-guard/migrations'),
    path.join(repoRoot, 'packages/capability-broker/migrations'),
  ];
  for (const c of candidates) {
    try {
      await fs.access(path.join(c, 'meta', '_journal.json'));
      roots.push(c);
    } catch {
      // skip
    }
  }
  return roots;
}
