/**
 * `apps/wizard/lib/wizard/tier-resolver.ts` — resolve a tenant's
 * subscription tier for the Phase C3 usage meter.
 *
 * Reads from `caia_meta.tenant_subscriptions` (seeded by
 * `@caia/billing` Layer 1 webhook handler) via the wizard's existing
 * pg pool. Returns `'free'` when the tenant has no row — matches the
 * webhook handler's default at tenant creation.
 *
 * Lazy-imports the pool so unit tests that override the meter via
 * `setWizardClaudeMeter(...)` never hit pg.
 */

let _override: ((tenantId: string) => Promise<'free' | 'professional' | 'team'>) | null = null;

export function setTenantTierResolverOverride(
  resolver: ((tenantId: string) => Promise<'free' | 'professional' | 'team'>) | null,
): void {
  _override = resolver;
}

export async function resolveTenantTierForMeter(
  tenantId: string,
): Promise<'free' | 'professional' | 'team'> {
  if (_override !== null) {
    return _override(tenantId);
  }
  try {
    const { getPool } = await import('../tenants/wire');
    const pool = getPool() as unknown as {
      query: <R>(sql: string, params?: ReadonlyArray<unknown>) => Promise<{ rows: R[] }>;
    };
    const { rows } = await pool.query<{ tier: 'free' | 'professional' | 'team' }>(
      `SELECT tier FROM caia_meta.tenant_subscriptions WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    return rows[0]?.tier ?? 'free';
  } catch {
    // No subscription store / no pg → treat as free-tier so the
    // meter short-circuits cleanly. The dashboard's prod path should
    // always have the table populated; this fallback exists for
    // V1-shaped dev environments.
    return 'free';
  }
}
