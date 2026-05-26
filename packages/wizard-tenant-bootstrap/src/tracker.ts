/**
 * The `_migrations_applied` ledger — per-schema record of what's been run.
 *
 * Lives INSIDE each tenant's schema as `"{{SCHEMA}}"._migrations_applied`.
 * Schema-local placement means dropping the schema (e.g. on provisioning
 * rollback) cleans the ledger too — no orphan rows in a global table.
 *
 * Composite primary key (package, filename) so a file in one package and
 * an identically-named file in another don't collide. Filenames are NOT
 * unique across packages on their own (e.g. every package's first
 * migration is named `0001_*.sql`).
 *
 * `checksum` is the SHA-256 of the POST-substitution SQL — the SQL we
 * actually ran. If a file is edited (e.g. a new column added), the
 * checksum changes and the runner re-applies it. Re-applying is safe
 * because the per-package SQL is idempotent (`CREATE TABLE IF NOT EXISTS`,
 * `DROP TRIGGER IF EXISTS … CREATE TRIGGER`, etc.).
 */

import { createHash } from 'node:crypto';

import { assertValidTenantSchema, quoteSchema } from './schema.js';
import type { PgPoolLike } from './types.js';

export const TRACKER_TABLE_NAME = '_migrations_applied';

/**
 * Bootstrap the tracker table inside the target schema. Idempotent.
 *
 * Called by the runner BEFORE the first manifest entry is evaluated —
 * without this, we couldn't record which migrations have already run.
 */
export async function ensureTrackerTable(pool: PgPoolLike, schemaName: string): Promise<void> {
  assertValidTenantSchema(schemaName);
  const quoted = quoteSchema(schemaName);
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quoted}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${quoted}.${TRACKER_TABLE_NAME} (
      package      TEXT        NOT NULL,
      filename     TEXT        NOT NULL,
      checksum     TEXT        NOT NULL,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (package, filename)
    )
  `);
}

export interface TrackerRow {
  readonly packageName: string;
  readonly filename: string;
  readonly checksum: string;
  readonly appliedAt: Date;
}

/** Read the current row for a given (package, filename), or null. */
export async function readTracker(
  pool: PgPoolLike,
  schemaName: string,
  packageName: string,
  filename: string,
): Promise<TrackerRow | null> {
  const quoted = quoteSchema(schemaName);
  const res = await pool.query<{
    package: string;
    filename: string;
    checksum: string;
    applied_at: string | Date;
  }>(
    `SELECT package, filename, checksum, applied_at
       FROM ${quoted}.${TRACKER_TABLE_NAME}
      WHERE package = $1 AND filename = $2
      LIMIT 1`,
    [packageName, filename],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    packageName: row.package,
    filename: row.filename,
    checksum: row.checksum,
    appliedAt: new Date(row.applied_at),
  };
}

/** Upsert the tracker row after a successful apply or re-apply. */
export async function recordTracker(
  pool: PgPoolLike,
  schemaName: string,
  packageName: string,
  filename: string,
  checksum: string,
): Promise<void> {
  const quoted = quoteSchema(schemaName);
  await pool.query(
    `INSERT INTO ${quoted}.${TRACKER_TABLE_NAME} (package, filename, checksum, applied_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (package, filename) DO UPDATE
       SET checksum = EXCLUDED.checksum,
           applied_at = EXCLUDED.applied_at`,
    [packageName, filename, checksum],
  );
}

/** SHA-256 hex of the substituted SQL. Used as the idempotency checksum. */
export function sqlChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}
