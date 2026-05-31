/**
 * Lazy per-tenant `StateStore` factory.
 *
 * The wizard route handlers need a `@caia/state-machine` `StateStore`
 * scoped to a tenant's Postgres schema. We cache one store per tenant
 * for the process lifetime; a process restart re-instantiates.
 *
 * Reuse-first: uses `@caia/state-machine`'s `PgStateStore` directly. No
 * inline FSM, no parallel persistence.
 *
 * Phase B Task B4 (2026-05-31): also exposes `resolveTenantSchema` so
 * route handlers can wrap their pg work with `withTenantSearchPath`.
 * The schema name is cached alongside the StateStore so repeated calls
 * don't re-hit the global `tenants` table.
 */

import { Pool } from 'pg';
import { getPool } from '../tenants/wire';
import type { StateStore } from '@caia/state-machine';

interface TenantWiring {
  store: StateStore;
  schemaName: string;
}

const cache = new Map<string, TenantWiring>();

async function loadTenantWiring(tenantId: string): Promise<TenantWiring> {
  const existing = cache.get(tenantId);
  if (existing) return existing;
  const { PgStateStore } = await import('@caia/state-machine');
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
  const store = new (PgStateStore as unknown as new (opts: {
    pool: Pool;
    schema?: string;
  }) => StateStore)({ pool, schema: schemaName });
  const wiring: TenantWiring = { store, schemaName };
  cache.set(tenantId, wiring);
  void ts;
  return wiring;
}

export async function getStateStoreForTenant(tenantId: string): Promise<StateStore> {
  const w = await loadTenantWiring(tenantId);
  return w.store;
}

/**
 * Resolve the Postgres schema name for `tenantId`. Used by route
 * handlers to wire `withTenantSearchPath`. Cached for the process
 * lifetime via the same map as `getStateStoreForTenant`.
 */
export async function resolveTenantSchema(tenantId: string): Promise<string> {
  const w = await loadTenantWiring(tenantId);
  return w.schemaName;
}

/** Test-only — drop the cache. */
export function __resetStoreWireCache(): void {
  cache.clear();
}
