/**
 * Adapter registry + per-tenant dispatcher.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §3.1.
 *
 * Production wiring:
 *   1. The application boot stage calls `registerAdapter('cd-zip', CdZipAdapter)`
 *      for every adapter it ships.
 *   2. Inbound `POST /api/ingest/upload` (or a webhook) calls
 *      `getDesignAdapterForTenant(tenantId, deps)`. That helper reads
 *      `caia_meta.tenants.preferred_design_source`, looks up the
 *      adapter, and constructs it with the per-tenant `AdapterDeps`.
 *
 * The registry is a process-local Map — every node boots into a fresh
 * one and registers the adapters it knows about. There is no cross-
 * process sharing; that would invite stale-adapter bugs across deploys.
 */

import type { AdapterDeps, DesignAdapter, DesignAdapterCtor } from './types.js';
import type { PoolLike } from './pg-types.js';
import type { SourceName } from './schema.js';
import { ProviderNotSupported, DesignIngestError } from './errors.js';

/**
 * Default registry — module-singleton. Tests instantiate their own
 * `Registry` via `new Registry()` to avoid pollution.
 */
export class Registry {
  private readonly map = new Map<SourceName, DesignAdapterCtor>();

  /** True if `source` has an adapter registered. */
  has(source: SourceName): boolean {
    return this.map.has(source);
  }

  /** List every source currently registered. */
  list(): SourceName[] {
    return Array.from(this.map.keys());
  }

  /**
   * Register an adapter. By default, a second registration for the
   * same source throws — silent overrides are a footgun in production.
   * Pass `force: true` to swap (tests use this).
   */
  register(
    source: SourceName,
    ctor: DesignAdapterCtor,
    opts: { force?: boolean } = {},
  ): void {
    if (this.map.has(source) && !opts.force) {
      throw new DesignIngestError(
        'adapter_already_registered',
        `adapter for source ${source} is already registered; pass {force: true} to replace`,
        { source },
      );
    }
    this.map.set(source, ctor);
  }

  /** Remove all registrations. Tests use this between cases. */
  clear(): void {
    this.map.clear();
  }

  /** Resolve and instantiate. Throws `ProviderNotSupported` on miss. */
  resolve(source: SourceName, deps: AdapterDeps): DesignAdapter {
    const Ctor = this.map.get(source);
    if (!Ctor) {
      throw new ProviderNotSupported(source);
    }
    return new Ctor(deps);
  }
}

/** Process-global default registry. */
export const DESIGN_ADAPTER_REGISTRY = new Registry();

/** Convenience shim — `DESIGN_ADAPTER_REGISTRY.register(...)`. */
export function registerAdapter(
  source: SourceName,
  ctor: DesignAdapterCtor,
  opts: { force?: boolean } = {},
): void {
  DESIGN_ADAPTER_REGISTRY.register(source, ctor, opts);
}

// ---------------------------------------------------------------------------
// Per-tenant dispatcher
// ---------------------------------------------------------------------------

export interface TenantPreferenceRow {
  preferred_design_source: SourceName;
}

/**
 * Read the per-tenant preference row. Production wires to the
 * `caia_meta.tenants` table; tests provide a stub function.
 *
 * Kept as a callback (rather than inlined SQL) so this package has no
 * opinion about the tenants table location — the host application
 * decides which schema holds it.
 */
export type ResolveTenantPreferredSource = (
  tenantId: string,
  pg: PoolLike,
) => Promise<SourceName>;

/**
 * Default resolver — runs
 *   `SELECT preferred_design_source FROM caia_meta.tenants WHERE id = $1`.
 * Throws `tenant_not_found` if no row matches.
 */
export const defaultResolveTenantPreferredSource: ResolveTenantPreferredSource =
  async (tenantId, pg) => {
    const res = await pg.query<TenantPreferenceRow>(
      `SELECT preferred_design_source FROM caia_meta.tenants WHERE id = $1`,
      [tenantId],
    );
    const row = res.rows[0];
    if (!row) {
      throw new DesignIngestError(
        'tenant_not_found',
        `tenant ${tenantId} not found in caia_meta.tenants`,
        { tenantId },
      );
    }
    return row.preferred_design_source;
  };

/**
 * Look up the tenant's preferred source and instantiate that adapter.
 *
 * The framework caller passes per-tenant `AdapterDeps` — those have
 * already been resolved (secrets, blob storage, snapshotter, the
 * `AccessContext` envelope). This function only adds the
 * registry-lookup step.
 */
export async function getDesignAdapterForTenant(
  tenantId: string,
  deps: AdapterDeps,
  opts: {
    registry?: Registry;
    resolveSource?: ResolveTenantPreferredSource;
  } = {},
): Promise<DesignAdapter> {
  const registry = opts.registry ?? DESIGN_ADAPTER_REGISTRY;
  const resolveSource = opts.resolveSource ?? defaultResolveTenantPreferredSource;
  const source = await resolveSource(tenantId, deps.pg);
  return registry.resolve(source, deps);
}
