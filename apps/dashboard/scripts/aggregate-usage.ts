#!/usr/bin/env node
/**
 * `scripts/aggregate-usage.ts` — Phase C3 monthly aggregation cron.
 *
 * Runs once per month (1st of the month, 00:30 UTC). For every
 * subscription-tier tenant (`tier IN ('professional','team')`):
 *
 *   1. Compute `yyyymm` for the previous calendar month.
 *   2. `meter.aggregateMonth(tenantId, yyyymm)` — sums un-aggregated
 *      rows into `tenant_usage_meter_aggregates`.
 *   3. `meter.postStripeUsageRecord(tenantId, aggregate)` — posts the
 *      monthly total to Stripe via `subscriptionItems.createUsageRecord`.
 *      Stub-mode tolerant: when `STRIPE_SECRET_KEY` is unset, this
 *      step writes `stripe_post_status='stubbed'` and the script logs
 *      a single warning.
 *
 * Re-running the cron for the same month is idempotent — the
 * aggregate row's `(tenant_id, yyyymm)` PK + the `posted` /
 * `stubbed` short-circuit in `postStripeUsageRecord` together ensure
 * no double posting. Stubbed aggregates are retried automatically on
 * the next cron tick once the Stripe key arrives in Infisical.
 *
 * Schedule wiring: the operator adds this to chain-runner's
 * `bootstrap-chain` config or whatever cron daemon manages dashboard
 * cron entries. The script is a standalone `node` invocation so the
 * schedule can be expressed in standard cron syntax:
 *
 *     30 0 1 * *   node apps/dashboard/scripts/aggregate-usage.ts
 *
 * Environment:
 *   - DATABASE_URL              (required) — Postgres connection.
 *   - STRIPE_SECRET_KEY         (optional) — when present, live mode;
 *                                            absent → stub mode.
 *   - CAIA_BILLING_SCHEMA       (optional) — defaults to 'caia_meta'.
 *   - CAIA_AGGREGATE_YYYYMM     (optional) — override the month to
 *                                            aggregate. Useful for
 *                                            back-fill: pass e.g.
 *                                            `202604` to re-aggregate
 *                                            April 2026.
 *   - CAIA_AGGREGATE_DRY_RUN    (optional) — when `'1'`, log what
 *                                            would happen but don't
 *                                            write anything.
 *
 * Reuse-first: this script imports `@caia/billing.UsageMeter` and
 * does NOT re-implement any of `recordUsage`, `aggregateMonth`, or
 * `postStripeUsageRecord`. The cron is purely orchestration.
 */

import {
  UsageMeter,
  previousYyyymm,
  defaultStripeInit,
  type PgLike,
  type StripeMeterLike,
  type UsageMeterConfig,
} from '@caia/billing';

// ---------- Tiny PG client wrapper ----------

/**
 * Cron-side `PgLike` impl built atop `pg.Pool`. Kept inline because
 * the cron is the only consumer here; the meter package itself stays
 * driver-agnostic.
 *
 * `pg` is a runtime dep of the dashboard (already declared) — we
 * import lazily so the meter unit tests don't need it.
 */
async function createPgClient(): Promise<{ pg: PgLike; close: () => Promise<void> }> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error(
      'aggregate-usage: DATABASE_URL env var is required. ' +
        'Operator must source it from Infisical at caia_global.dashboard.database_url before invoking the cron.',
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = (await import('pg')) as { Pool: new (cfg: { connectionString: string }) => unknown };
  const pool = new Pool({ connectionString: databaseUrl }) as {
    query: <R>(sql: string, params?: ReadonlyArray<unknown>) => Promise<{ rows: R[]; rowCount?: number | null }>;
    end: () => Promise<void>;
  };
  return {
    pg: {
      query: async <R>(sql: string, params?: ReadonlyArray<unknown>) =>
        pool.query<R>(sql, params),
    },
    close: () => pool.end(),
  };
}

// ---------- Tenant enumeration ----------

interface SubscriptionRow {
  tenant_id: string;
  tier: 'free' | 'professional' | 'team';
  stripe_subscription_id: string | null;
}

async function listSubscriptionTierTenants(pg: PgLike, schema: string): Promise<SubscriptionRow[]> {
  const { rows } = await pg.query<SubscriptionRow>(
    `SELECT tenant_id::text AS tenant_id, tier, stripe_subscription_id
       FROM ${schema}.tenant_subscriptions
      WHERE tier IN ('professional','team')
        AND status IN ('active','trialing','past_due')`,
    [],
  );
  return rows;
}

// ---------- Subscription-item resolution ----------

/**
 * Look up the Stripe `subscription_item` id this tenant's metered
 * billing posts to. Operator wires this mapping in Postgres via a
 * future migration; for the C3 ship we read it from a sibling table
 * `tenant_subscription_items(tenant_id, subscription_item_id)`. When
 * the table doesn't exist OR no row matches, we return `null` so the
 * post becomes a stub.
 */
function makeSubscriptionItemResolver(pg: PgLike, schema: string): (tenantId: string) => Promise<string | null> {
  return async (tenantId: string): Promise<string | null> => {
    try {
      const { rows } = await pg.query<{ subscription_item_id: string }>(
        `SELECT subscription_item_id
           FROM ${schema}.tenant_subscription_items
          WHERE tenant_id = $1`,
        [tenantId],
      );
      return rows[0]?.subscription_item_id ?? null;
    } catch {
      // Table missing → operator hasn't set up metered billing yet.
      // Stub mode handles this gracefully.
      return null;
    }
  };
}

// ---------- main ----------

async function main(): Promise<void> {
  const schema = process.env['CAIA_BILLING_SCHEMA'] ?? 'caia_meta';
  const yyyymmOverride = process.env['CAIA_AGGREGATE_YYYYMM'];
  const dryRun = process.env['CAIA_AGGREGATE_DRY_RUN'] === '1';

  const yyyymm = yyyymmOverride !== undefined && yyyymmOverride.length > 0
    ? Number(yyyymmOverride)
    : previousYyyymm();

  if (!Number.isInteger(yyyymm) || yyyymm < 200001 || yyyymm > 299912) {
    throw new Error(`aggregate-usage: bad yyyymm "${String(yyyymm)}" — must be YYYYMM (e.g. 202604).`);
  }

  console.info(`[aggregate-usage] starting`, { yyyymm, schema, dryRun });

  const { pg, close } = await createPgClient();
  try {
    const meter = new UsageMeter({
      pg,
      schema,
      // resolveStripeSecretKey reads STRIPE_SECRET_KEY automatically;
      // we only override here when the env var is absent so stub-mode
      // is the default at boot.
      stripeInit: defaultStripeInit() satisfies UsageMeterConfig['stripeInit'] as (apiKey: string) => StripeMeterLike,
      resolveSubscriptionItem: makeSubscriptionItemResolver(pg, schema),
    });

    const mode = meter.isLive ? 'live' : `stub (${meter.stubReason ?? 'unknown'})`;
    console.info(`[aggregate-usage] meter mode: ${mode}`);

    const tenants = await listSubscriptionTierTenants(pg, schema);
    console.info(`[aggregate-usage] tenants to aggregate: ${String(tenants.length)}`);

    const summary = { posted: 0, stubbed: 0, failed: 0, skipped: 0 };

    for (const tenant of tenants) {
      try {
        if (dryRun) {
          console.info(`[aggregate-usage] dry-run skip`, { tenantId: tenant.tenant_id });
          summary.skipped++;
          continue;
        }
        const aggregate = await meter.aggregateMonth(tenant.tenant_id, yyyymm);
        const result = await meter.postStripeUsageRecord(tenant.tenant_id, aggregate);
        switch (result.status) {
          case 'posted':
            summary.posted++;
            console.info(`[aggregate-usage] posted`, {
              tenantId: tenant.tenant_id,
              yyyymm,
              stripeUsageRecordId: result.stripeUsageRecordId,
            });
            break;
          case 'stubbed':
            summary.stubbed++;
            console.warn(`[aggregate-usage] stubbed`, {
              tenantId: tenant.tenant_id,
              yyyymm,
              reason: result.reason ?? 'unknown',
            });
            break;
          case 'failed':
            summary.failed++;
            console.error(`[aggregate-usage] failed`, {
              tenantId: tenant.tenant_id,
              yyyymm,
              error: result.error?.message ?? 'unknown',
            });
            break;
        }
      } catch (err) {
        summary.failed++;
        console.error(`[aggregate-usage] tenant error`, {
          tenantId: tenant.tenant_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    console.info(`[aggregate-usage] complete`, summary);
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error('[aggregate-usage] FATAL', err);
  process.exit(1);
});
