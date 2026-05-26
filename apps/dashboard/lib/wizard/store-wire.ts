/**
 * Lazy per-tenant `StateStore` factory.
 *
 * The wizard route handlers need a `@caia/state-machine` `StateStore`
 * scoped to a tenant's Postgres schema. We cache one store per tenant
 * for the process lifetime; a process restart re-instantiates.
 *
 * Reuse-first: uses `@caia/state-machine`'s `PgStateStore` directly. No
 * inline FSM, no parallel persistence.
 */

import { Pool } from 'pg';
import { getPool } from '../tenants/wire';
import type { StateStore } from '@caia/state-machine';

const cache = new Map<string, StateStore>();

export async function getStateStoreForTenant(tenantId: string): Promise<StateStore> {
  const existing = cache.get(tenantId);
  if (existing) return existing;
  const { PgStateStore } = await import('@caia/state-machine');
  // PgStateStore takes a pool + schema/table options. The tenants table
  // gives us `schema_name`; for the wizard MVP we use the **global** pool
  // and tell PgStateStore which schema to target. We re-derive the schema
  // name from the tenantId via a one-shot lookup (cached upstream by the
  // TenantStore — see `lib/tenants/store.ts`).
  const { TenantStore } = await import('../tenants/store');
  const pool: Pool = getPool();
  const ts = new TenantStore({ pool });
  // tenantId-keyed lookup. We do a parallel `findById` via a small query.
  const res = await pool.query(
    'SELECT schema_name FROM tenants WHERE tenant_id = $1 LIMIT 1',
    [tenantId],
  );
  if (res.rowCount === 0) {
    throw new Error(`No tenant for id=${tenantId}`);
  }
  const schemaName = String(res.rows[0].schema_name);
  // We construct PgStateStore against the resolved schema. The full
  // option shape depends on the @caia/state-machine version; we
  // intentionally use a structural cast to avoid version-pinning the
  // app to its private options surface.
  const store = new (PgStateStore as unknown as new (opts: {
    pool: Pool;
    schema?: string;
  }) => StateStore)({ pool, schema: schemaName });
  cache.set(tenantId, store);
  // ts is unused but exposes the lookup pattern for future per-tenant
  // schema invalidation; suppressing the unused-locals warning explicitly.
  void ts;
  return store;
}

/** Test-only — drop the cache. */
export function __resetStoreWireCache(): void {
  cache.clear();
}
