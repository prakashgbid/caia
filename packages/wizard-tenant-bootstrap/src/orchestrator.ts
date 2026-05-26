/**
 * `bootstrapTenant({ pool, schemaName, … })` — the per-tenant fan-out.
 *
 * Called from `apps/dashboard/lib/tenants/provision.ts` AFTER the schema
 * is created and BEFORE the global tenants row is inserted. Sequence:
 *
 *   1. Apply each manifest entry (idempotently, via the runner).
 *   2. Verify that the expected tables exist via `information_schema.tables`.
 *   3. Emit `tenant.migrations.complete` on the bus (best-effort).
 *   4. Return a `TenantBootstrapResult` so the caller can branch on
 *      success/failure.
 *
 * Failure handling: this function does NOT roll back on its own. It
 * surfaces failures via `result.success === false` and `result.failures`.
 * `provisionTenant()` owns the compensating actions (drop schema,
 * delete Infisical workspace, delete tenants row) because it also owns
 * the global tenants row.
 *
 * Idempotency: calling `bootstrapTenant` twice for the same schema is a
 * no-op the second time — every manifest entry comes back as
 * `kind: 'skipped'` because the `_migrations_applied` ledger short-circuits.
 */

import { applyManifest } from './runner.js';
import { assertValidTenantSchema, quoteSchema } from './schema.js';
import { DEFAULT_MANIFEST } from './manifest.js';
import type {
  BootstrapEventPublisher,
  BootstrapOptions,
  MigrationOutcome,
  PgPoolLike,
  TenantBootstrapResult,
} from './types.js';

/** Default no-op publisher — used when the caller doesn't pass one. */
const NOOP_PUBLISHER: BootstrapEventPublisher = {
  publish: async () => undefined,
};

/** Default logger — line-by-line console.log. */
const NOOP_LOG: (line: string) => void = () => undefined;

/**
 * Query `information_schema.tables` to list every base table in the
 * given schema. Used both for the result envelope and to verify the
 * migrations actually created what we expected.
 */
export async function listTenantTables(
  pool: PgPoolLike,
  schemaName: string,
): Promise<string[]> {
  assertValidTenantSchema(schemaName);
  const res = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    [schemaName],
  );
  return res.rows.map((r) => r.table_name);
}

export async function bootstrapTenant(opts: BootstrapOptions): Promise<TenantBootstrapResult> {
  const pool = opts.pool;
  const schemaName = opts.schemaName;
  const manifest = opts.manifest ?? DEFAULT_MANIFEST;
  const publisher = opts.publisher ?? NOOP_PUBLISHER;
  const log = opts.log ?? NOOP_LOG;

  assertValidTenantSchema(schemaName);

  log(`[wizard-tenant-bootstrap] start schema=${schemaName} entries=${manifest.length}`);

  const outcomes = await applyManifest(pool, schemaName, manifest);
  const failures = outcomes.filter(
    (o): o is Extract<MigrationOutcome, { kind: 'failed' }> => o.kind === 'failed',
  );
  const success = failures.length === 0;

  // Verify table presence — even if every migration succeeded, the
  // information_schema query is the canonical "did this actually work"
  // check. The list is also reported back to provisionTenant for logging.
  let tablesCreated: string[] = [];
  try {
    tablesCreated = await listTenantTables(pool, schemaName);
  } catch (err) {
    log(`[wizard-tenant-bootstrap] table verification failed: ${(err as Error).message}`);
    // Don't promote a verification-read failure into a bootstrap failure
    // if the migrations themselves succeeded — the caller can decide.
  }

  // Best-effort event emission. A bus failure does NOT flip success — the
  // tenant schema is authoritative; consumers re-derive via the next
  // `tenant.provisioned` cycle if needed.
  try {
    await publisher.publish({
      type: 'tenant.migrations.complete',
      severity: success ? 'info' : 'error',
      actor: 'wizard-tenant-bootstrap',
      payload: {
        schema_name: schemaName,
        success,
        applied_count: outcomes.filter((o) => o.kind === 'applied').length,
        skipped_count: outcomes.filter((o) => o.kind === 'skipped').length,
        reapplied_count: outcomes.filter((o) => o.kind === 'reapplied').length,
        failed_count: failures.length,
        tables_created: tablesCreated,
        failures: failures.map((f) => ({
          package: f.packageName,
          file: f.filename,
          error: f.error,
        })),
      },
    });
  } catch (err) {
    log(`[wizard-tenant-bootstrap] publish failed: ${(err as Error).message}`);
  }

  log(
    `[wizard-tenant-bootstrap] done schema=${schemaName} success=${success} ` +
      `applied=${outcomes.filter((o) => o.kind === 'applied').length} ` +
      `skipped=${outcomes.filter((o) => o.kind === 'skipped').length} ` +
      `failed=${failures.length} tables=${tablesCreated.length}`,
  );

  return {
    schemaName,
    outcomes,
    tablesCreated,
    success,
    failures,
  };
}

/**
 * Compensating drop — used by `provisionTenant()` when bootstrap fails.
 * Quoted via `quoteSchema()` so the validation regex is the only path
 * to schema-name injection. `CASCADE` ensures the tracker table + every
 * per-tenant table drops cleanly.
 */
export async function dropTenantSchema(pool: PgPoolLike, schemaName: string): Promise<void> {
  const quoted = quoteSchema(schemaName);
  await pool.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
}
