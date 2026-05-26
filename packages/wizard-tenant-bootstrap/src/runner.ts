/**
 * Single-migration runner. Reads a SQL template, substitutes the
 * `{{SCHEMA}}` placeholder, applies it, and records the apply in the
 * `_migrations_applied` ledger.
 *
 * Mirrors the per-package `ensureSchema()` substitution pattern used by
 * `@caia/grand-idea`, `@caia/info-architect`, `@caia/interviewer`, and
 * `@caia/business-proposal-generator` — but centralised so we don't
 * have five copies that drift.
 *
 * Substitution rules:
 *   - The placeholder is the literal six-character string `{{SCHEMA}}`.
 *   - The replacement is the QUOTED Postgres identifier (`"tenant_…"`).
 *   - Files that already wrap the placeholder in double-quotes (e.g.
 *     `apps/dashboard/migrations/0010_wizard_state.sql` uses
 *     `"{{SCHEMA}}"`) end up with `""tenant_…""` after a naive replace.
 *     The runner detects and corrects this by collapsing duplicated
 *     adjacent double-quotes around an identifier. Trailing inner quotes
 *     are not common Postgres syntax so the collapse is safe.
 */

import { readFile } from 'node:fs/promises';

import { ensureTrackerTable, readTracker, recordTracker, sqlChecksum } from './tracker.js';
import { quoteSchema, assertValidTenantSchema } from './schema.js';
import type { MigrationEntry, MigrationOutcome, PgPoolLike } from './types.js';

/** Substitute `{{SCHEMA}}` for the quoted identifier and collapse accidental `""tenant_…""` repeats. */
export function substituteSchema(template: string, schemaName: string): string {
  const quoted = quoteSchema(schemaName); // e.g. `"tenant_foo_abc12345"`
  const replaced = template.replace(/\{\{SCHEMA\}\}/g, quoted);
  // If a migration wraps the placeholder in `"{{SCHEMA}}"` (the dashboard's
  // 0010_wizard_state.sql does), the naive replace produces `""tenant_…""`.
  // Collapse the doubled outer quotes back down to single quotes by
  // matching the exact pattern `""tenant_…""` and removing the outer pair.
  const bare = schemaName;
  const doubled = new RegExp(`""${escapeRegex(bare)}""`, 'g');
  return replaced.replace(doubled, quoted);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply a single migration to the target schema.
 *
 * Returns an outcome envelope describing what happened. NEVER throws —
 * a thrown error from `pool.query` is converted into a `failed` outcome
 * so the orchestrator can decide its rollback strategy.
 */
export async function applyMigration(
  pool: PgPoolLike,
  schemaName: string,
  entry: MigrationEntry,
): Promise<MigrationOutcome> {
  assertValidTenantSchema(schemaName);
  let template: string;
  try {
    template = await readFile(entry.sqlPath, 'utf8');
  } catch (err) {
    return {
      kind: 'failed',
      packageName: entry.packageName,
      filename: entry.filename,
      error: `read ${entry.sqlPath}: ${(err as Error).message}`,
    };
  }

  const sql = substituteSchema(template, schemaName);
  const checksum = sqlChecksum(sql);

  // Has this migration already run in this schema?
  let existing;
  try {
    existing = await readTracker(pool, schemaName, entry.packageName, entry.filename);
  } catch (err) {
    return {
      kind: 'failed',
      packageName: entry.packageName,
      filename: entry.filename,
      error: `read tracker: ${(err as Error).message}`,
    };
  }

  if (existing && existing.checksum === checksum) {
    return {
      kind: 'skipped',
      packageName: entry.packageName,
      filename: entry.filename,
      reason: 'already-applied',
      existingChecksum: existing.checksum,
    };
  }

  const start = Date.now();
  try {
    await pool.query(sql);
  } catch (err) {
    return {
      kind: 'failed',
      packageName: entry.packageName,
      filename: entry.filename,
      error: `apply: ${(err as Error).message}`,
    };
  }
  const durationMs = Date.now() - start;

  try {
    await recordTracker(pool, schemaName, entry.packageName, entry.filename, checksum);
  } catch (err) {
    return {
      kind: 'failed',
      packageName: entry.packageName,
      filename: entry.filename,
      error: `record tracker: ${(err as Error).message}`,
    };
  }

  if (existing) {
    return {
      kind: 'reapplied',
      packageName: entry.packageName,
      filename: entry.filename,
      durationMs,
      oldChecksum: existing.checksum,
      newChecksum: checksum,
    };
  }
  return {
    kind: 'applied',
    packageName: entry.packageName,
    filename: entry.filename,
    durationMs,
    checksum,
  };
}

/**
 * Convenience: ensure the tracker table exists, then apply every entry
 * in order. Stops at the first failure (does NOT continue) — the
 * orchestrator decides what to do with the partial result.
 */
export async function applyManifest(
  pool: PgPoolLike,
  schemaName: string,
  manifest: ReadonlyArray<MigrationEntry>,
): Promise<MigrationOutcome[]> {
  await ensureTrackerTable(pool, schemaName);
  const outcomes: MigrationOutcome[] = [];
  for (const entry of manifest) {
    const outcome = await applyMigration(pool, schemaName, entry);
    outcomes.push(outcome);
    if (outcome.kind === 'failed') break;
  }
  return outcomes;
}
