/**
 * Migration numbering analyzer (failure mode #3).
 *
 * Scans a Drizzle migrations directory for:
 *   - Duplicate prefixes (block) — two .sql files share the same 4-digit
 *     numeric prefix. Recurrent issue causing DIRTY release PRs. Example
 *     in develop 2026-05-04: 0037_irreversible_actions.sql +
 *     0037_story_capsule.sql.
 *   - Gaps in the prefix sequence (warn) — e.g. files at 0040 and 0042
 *     with nothing at 0041. Could be intentional reservation but more
 *     often indicates a renumbered or dropped migration.
 *
 * Reference: architecture doc §3.3.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Finding } from './types.js';
import { loadJournal } from './migration-linter.js';

const PREFIX_RE = /^(\d{4})_/;

export interface CheckMigrationNumberingOptions {
  migrationsDir: string;
}

interface MigrationFile {
  basename: string;
  prefix: number;
  inJournal: boolean;
}

export async function checkMigrationNumbering(
  opts: CheckMigrationNumberingOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const dir = opts.migrationsDir;
  const journal = await loadJournal(path.join(dir, 'meta'));
  const journalTags = new Set<string>();
  if (journal) for (const e of journal.entries) journalTags.add(e.tag);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    return [
      {
        analyzer: 'migration-numbering',
        ruleId: 'migrations-dir-unreadable',
        path: dir,
        severity: 'block',
        message: `Cannot read migrations directory: ${(err as Error).message}`,
      },
    ];
  }

  const files: MigrationFile[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.sql')) continue;
    const m = PREFIX_RE.exec(entry);
    if (!m) {
      findings.push({
        analyzer: 'migration-numbering',
        ruleId: 'non-numeric-prefix',
        path: path.relative(process.cwd(), path.join(dir, entry)),
        severity: 'medium',
        message: `Migration filename does not start with a 4-digit prefix: ${entry}`,
        remediation: 'Rename the file to NNNN_<slug>.sql so Drizzle can order it deterministically.',
      });
      continue;
    }
    const prefix = parseInt(m[1] ?? '0', 10);
    const tag = entry.replace(/\.sql$/, '');
    files.push({ basename: entry, prefix, inJournal: journalTags.has(tag) });
  }

  // Group by prefix, flag duplicates as block-severity.
  const byPrefix = new Map<number, MigrationFile[]>();
  for (const f of files) {
    const arr = byPrefix.get(f.prefix) ?? [];
    arr.push(f);
    byPrefix.set(f.prefix, arr);
  }
  for (const [prefix, group] of byPrefix) {
    if (group.length > 1) {
      const filenames = group.map((g) => g.basename).sort();
      const inJournal = group.filter((g) => g.inJournal).map((g) => g.basename);
      const orphan = group.filter((g) => !g.inJournal).map((g) => g.basename);
      findings.push({
        analyzer: 'migration-numbering',
        ruleId: 'duplicate-prefix',
        path: path.relative(process.cwd(), path.join(dir, filenames[0] ?? '')),
        severity: 'block',
        message: `Duplicate migration prefix ${String(prefix).padStart(4, '0')}: ${filenames.join(', ')}. Drizzle journal can register only one tag per prefix; one of these is an orphan that will not apply.`,
        remediation: `Either delete the orphan file(s) (${orphan.join(', ') || 'none — both registered'}) or rename one to the next free prefix. In-journal: ${inJournal.join(', ') || 'none — both orphan'}.`,
        context: { prefix, files: filenames, inJournal, orphan },
      });
    }
  }

  // Gap detection (warn) — only on registered prefixes (orphan files
  // covered by the duplicate-prefix check).
  const registeredPrefixes = files
    .filter((f) => f.inJournal)
    .map((f) => f.prefix)
    .sort((a, b) => a - b);
  for (let i = 1; i < registeredPrefixes.length; i++) {
    const a = registeredPrefixes[i - 1];
    const b = registeredPrefixes[i];
    if (a === undefined || b === undefined) continue;
    if (b - a > 1) {
      findings.push({
        analyzer: 'migration-numbering',
        ruleId: 'numbering-gap',
        path: path.relative(process.cwd(), dir),
        severity: 'medium',
        message: `Gap in registered migration prefixes: ${String(a).padStart(4, '0')} -> ${String(b).padStart(4, '0')} (${b - a - 1} missing slot(s)).`,
        remediation: 'If intentional, add a noop placeholder. Otherwise investigate (likely a branch dropped or renumbered without journal update).',
        context: { gapStart: a, gapEnd: b, missingSlots: b - a - 1 },
      });
    }
  }

  return findings;
}

/** Suggest the next free prefix for a fresh migration in this dir. */
export function nextFreePrefix(usedPrefixes: number[]): number {
  if (usedPrefixes.length === 0) return 0;
  return Math.max(...usedPrefixes) + 1;
}
