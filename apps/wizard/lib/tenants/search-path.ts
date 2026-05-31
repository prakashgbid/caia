/**
 * `withTenantSearchPath(pool, tenantSchema, fn)` — per-request tenant
 * isolation via `SET LOCAL search_path`.
 *
 * Phase B Task B4 (2026-05-31). Before this helper, the wizard relied on
 * the pool-connection-level search_path (or, worse, the Postgres default
 * `"$user", public`) and trusted that PgStateStore's schema-qualified
 * inserts kept tenant data segregated. That's brittle: any future query
 * that references an unqualified table name would silently read/write
 * the wrong tenant's rows.
 *
 * Hardening:
 *   - acquire a pooled client,
 *   - `BEGIN`,
 *   - `SET LOCAL search_path = "<schema>", public`  (transaction-scoped),
 *   - run the caller's `fn(client)`,
 *   - `COMMIT` (or `ROLLBACK` on throw),
 *   - release the client back to the pool in `finally`.
 *
 * Why `SET LOCAL` (and not `SET`): `SET LOCAL` is scoped to the current
 * transaction — the moment the connection is returned to the pool, the
 * search_path reverts to its pool-default. That prevents a leaked
 * search_path from bleeding into the NEXT request that picks up the same
 * pooled connection.
 *
 * Reuse-first compliance:
 *   - Same pattern used by `@caia/atlas-design-snapshotter` (see
 *     `packages/atlas-design-snapshotter/src/snapshotter.ts:145`).
 *   - Same identifier-validation regex used by the snapshotter's
 *     `quoteIdent` so a schema name with quotes/dashes can never reach
 *     the SET statement.
 *   - Uses the wizard's existing `pg.Pool` from `lib/tenants/wire.ts`.
 *     No new database layer.
 */

import type { Pool, PoolClient } from 'pg';

/**
 * Postgres identifier rules for the tenant schema name. `schemaNameForEmail`
 * in `lib/tenants/store.ts` only emits `[a-z0-9_]` strings, so this is
 * defence-in-depth, not the primary trust boundary. The regex matches
 * the snapshotter's `quoteIdent` validator verbatim so the two places
 * agree on what a "safe" schema name looks like.
 */
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class InvalidTenantSchemaError extends Error {
  constructor(reason: string, public readonly tenantSchema: string) {
    super(`invalid tenant schema: ${reason}`);
    this.name = 'InvalidTenantSchemaError';
  }
}

/**
 * Quote a tenant-schema identifier for safe interpolation into a
 * `SET LOCAL search_path = …` statement.
 *
 * Throws `InvalidTenantSchemaError` if the input is empty, contains a
 * double-quote, or fails the Postgres-identifier regex. We do this
 * BEFORE issuing any SQL so a malformed schema name never reaches the
 * database — including via a hypothetical injection payload.
 */
export function quoteTenantIdent(tenantSchema: string): string {
  if (typeof tenantSchema !== 'string' || tenantSchema.length === 0) {
    throw new InvalidTenantSchemaError('empty schema name', String(tenantSchema));
  }
  if (tenantSchema.includes('"')) {
    throw new InvalidTenantSchemaError(
      'schema name contains a double-quote',
      tenantSchema,
    );
  }
  if (!IDENT_RE.test(tenantSchema)) {
    throw new InvalidTenantSchemaError(
      `schema must match [a-zA-Z_][a-zA-Z0-9_]*`,
      tenantSchema,
    );
  }
  return `"${tenantSchema}"`;
}

/**
 * Build the `SET LOCAL search_path` statement for a given tenant schema.
 * Exported for unit tests so they can assert the exact wire format
 * without rebuilding the regex / quoting logic.
 */
export function buildSetSearchPathStatement(tenantSchema: string): string {
  const quoted = quoteTenantIdent(tenantSchema);
  return `SET LOCAL search_path = ${quoted}, public`;
}

/**
 * Minimal pool surface we depend on. We type against this (rather than
 * the full `pg.Pool`) so tests can supply a stub without re-exporting
 * pg's full type surface.
 */
export interface WithTenantSearchPathPool {
  connect(): Promise<PoolClient>;
}

export interface WithTenantSearchPathOptions {
  /**
   * Reuse a caller-managed client + transaction. When supplied:
   *   - we DO NOT call `pool.connect()` or release the client,
   *   - we DO NOT issue `BEGIN`/`COMMIT`/`ROLLBACK` (the caller owns
   *     the transaction lifecycle),
   *   - we DO still issue `SET LOCAL search_path` — it remains scoped
   *     to the caller's transaction.
   *
   * Use this when you need multiple tenant-scoped operations to share a
   * single atomic transaction.
   */
  externalClient?: PoolClient;
}

/**
 * Run `fn(client)` inside a transaction with `search_path` pinned to
 * `tenantSchema`. The contract:
 *
 *   - if `fn` returns a value, this returns that value;
 *   - if `fn` throws, the transaction is rolled back and the error is
 *     rethrown verbatim (the original `.message`/`.stack` is preserved);
 *   - the pooled client is released back to the pool in a `finally`
 *     block — even if `fn` throws, even if `COMMIT` itself throws.
 *
 * The `externalClient` option lets a caller wire an existing transaction
 * through — the helper then only issues the `SET LOCAL`. This is useful
 * for routes that already hold an open transaction (e.g. the
 * provisioning fan-out).
 */
export async function withTenantSearchPath<T>(
  pool: WithTenantSearchPathPool,
  tenantSchema: string,
  fn: (client: PoolClient) => Promise<T>,
  opts: WithTenantSearchPathOptions = {},
): Promise<T> {
  // Validate BEFORE touching the pool so a bad schema name doesn't
  // even acquire a connection.
  const setStmt = buildSetSearchPathStatement(tenantSchema);

  // External transaction path — caller owns BEGIN/COMMIT/release.
  if (opts.externalClient) {
    await opts.externalClient.query(setStmt);
    return await fn(opts.externalClient);
  }

  const client = await pool.connect();
  let inTx = false;
  try {
    await client.query('BEGIN');
    inTx = true;
    await client.query(setStmt);
    const result = await fn(client);
    await client.query('COMMIT');
    inTx = false;
    return result;
  } catch (err) {
    if (inTx) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore — original error wins. A failed ROLLBACK usually
        // means the connection itself is unhealthy; `release(err)`
        // below will discard it from the pool.
      }
    }
    throw err;
  } finally {
    try {
      client.release();
    } catch {
      // Defensive: if release itself throws, swallow — the caller
      // already got their (success or failure) signal from the try
      // block, and we don't want a release error to mask it.
    }
  }
}
