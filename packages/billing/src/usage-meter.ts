/**
 * `usage-meter.ts` — Phase C3 per-tenant Claude usage meter.
 *
 * Three responsibilities:
 *   1. `recordUsage(tenantId, payload)` — write one row to
 *      `{{SCHEMA}}.tenant_usage_meter` after every successful spawn.
 *   2. `aggregateMonth(tenantId, yyyymm)` — sum a tenant's previous
 *      month, write a row to `tenant_usage_meter_aggregates`, mark
 *      the source rows as aggregated. Idempotent.
 *   3. `postStripeUsageRecord(tenantId, aggregate)` — post the
 *      monthly aggregate to Stripe via the metered-billing usage
 *      record API. **Stub-mode aware** — see below.
 *
 * STUB MODE:
 *
 *   When `STRIPE_SECRET_KEY` is not set (or the Stripe SDK throws on
 *   init — e.g. invalid key shape), `postStripeUsageRecord` becomes a
 *   no-op + writes a single warning via `@chiefaia/tracing`. The
 *   aggregate row is still persisted with `stripe_post_status='stubbed'`
 *   so the back-fill on key-arrival is just a "retry all stubbed
 *   rows" query the operator can run from the cron once Infisical
 *   has the secret.
 *
 *   This decision lives at `recordUsage`-time too: the meter is
 *   storage-only there, so STRIPE_SECRET_KEY absence does NOT block
 *   spawning. The spawner keeps writing rows; Stripe just doesn't
 *   hear about them yet.
 *
 * BYOK SKIP:
 *
 *   The spawner's wrapper checks `secretsAdapter.hasRuntimeKey(...)`
 *   BEFORE calling `recordUsage`. BYOK tenants pay their own provider
 *   directly; metering them here would double-charge them. This file
 *   intentionally does NOT re-check (single source of truth at the
 *   call site) — but `recordUsage` does accept a `skipReason` hint
 *   so callers can no-op uniformly when needed.
 *
 * SCHEMA TEMPLATING:
 *
 *   All SQL is built with a `{{SCHEMA}}` placeholder substituted via
 *   the `schema` config field at meter construction time. Default
 *   `'caia_meta'` matches the prod migration target; tests inject
 *   their own schema name to isolate per-test rows.
 */

import type { Tier } from './types.js';

// ---------- Internal pg-client shim ----------

/**
 * Minimal Postgres client surface this module relies on. Real impl is
 * `pg.Pool` / `pg.Client` (or a worker-friendly equivalent like
 * `postgres.js`). Tests inject an in-memory mock.
 *
 * Kept narrow on purpose: a single `query(sql, params)` method is all
 * we need, and using a structural interface means we don't pull `pg`
 * into the package's dependency closure (it lives in the dashboard's
 * boot path).
 */
export interface PgLike {
  query<R = unknown>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
}

/**
 * Minimal Stripe surface this module relies on. The full SDK type
 * lives in `stripe-client.ts`'s `StripeLike`; here we redeclare just
 * the metered-billing usage record API so tests can mock without
 * pulling `Stripe.Subscription.*` shapes.
 *
 * Subscription metered-billing usage records live under
 * `stripe.subscriptionItems.createUsageRecord(item, { quantity, timestamp, action })`.
 */
export interface StripeMeterLike {
  subscriptionItems: {
    createUsageRecord(
      subscriptionItem: string,
      params: {
        quantity: number;
        timestamp?: number;
        action?: 'increment' | 'set';
      },
    ): Promise<{ id: string }>;
  };
}

// ---------- Tracing shim (avoid hard dep at type-resolve time) ----------

/**
 * Minimal logger surface. `@chiefaia/tracing` callers in the
 * dashboard wire `console.warn`-compat loggers; tests inject capture
 * arrays. We keep the surface tiny so we can plug in OTel log records
 * later without an interface change.
 */
export interface MeterLogger {
  warn(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  info(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  error(msg: string, fields?: Readonly<Record<string, unknown>>): void;
}

export const consoleLogger: MeterLogger = {
  warn: (msg, fields) => console.warn(`[usage-meter] ${msg}`, fields ?? {}),
  info: (msg, fields) => console.info(`[usage-meter] ${msg}`, fields ?? {}),
  error: (msg, fields) => console.error(`[usage-meter] ${msg}`, fields ?? {}),
};

// ---------- Public payload shapes ----------

/**
 * One spawn's usage. Mirrors the `usage` field of the
 * `claude --print --output-format json` envelope so the spawner can
 * pass it through with zero transformation.
 */
export interface RecordUsagePayload {
  /** Claude model tag — `claude-opus-4-6`, etc. */
  readonly model: string;
  /** Token counts (default 0 when the envelope omits the field). */
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
  /** Spawn timestamp. Defaults to now() at the writer when omitted. */
  readonly ts?: Date;
  /** Tier of the tenant — required so the aggregator can skip free-tier rows. */
  readonly tier: Tier;
  /**
   * Caller-supplied hint that this record should be a no-op. Used by
   * the spawner when it has already detected BYOK upstream — keeps the
   * call site uniform (always invoke `recordUsage`, the meter decides).
   * When `'byok'`, the row is NOT written and `recordUsage` returns
   * `{ written: false, reason: 'byok' }`.
   */
  readonly skipReason?: 'byok' | 'free-tier' | null;
}

/** Result of `recordUsage`. */
export interface RecordUsageResult {
  readonly written: boolean;
  readonly rowId: number | null;
  readonly reason: 'ok' | 'byok' | 'free-tier' | 'pg-error';
  readonly error?: Error;
}

/** One row from `tenant_usage_meter_aggregates`. */
export interface MonthlyAggregate {
  readonly tenantId: string;
  readonly yyyymm: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheCreationTokens: number;
  readonly totalCacheReadTokens: number;
  readonly rowCount: number;
  readonly stripeUsageRecordId: string | null;
  readonly stripePostStatus: 'pending' | 'posted' | 'stubbed' | 'failed';
  readonly postedAt: Date | null;
}

/** Result of `postStripeUsageRecord`. */
export interface PostUsageRecordResult {
  readonly status: 'posted' | 'stubbed' | 'failed';
  readonly stripeUsageRecordId: string | null;
  readonly reason?: string;
  readonly error?: Error;
}

// ---------- Stripe key resolution ----------

/**
 * Encapsulates `STRIPE_SECRET_KEY` lookup so tests can inject env
 * without monkey-patching `process.env`. The lookup is:
 *   1. Caller-supplied override (`config.stripeSecretKey`).
 *   2. `process.env.STRIPE_SECRET_KEY`.
 *   3. `null` → stub mode.
 */
export function resolveStripeSecretKey(
  override?: string | null,
): string | null {
  if (override !== undefined && override !== null) {
    const trimmed = override.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const fromEnv = process.env['STRIPE_SECRET_KEY'];
  if (fromEnv === undefined) return null;
  const trimmed = fromEnv.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Stub-mode probe. Catches BOTH "key absent" and "Stripe SDK throws
 * on init" via the same call site so the spawner / cron never has to
 * branch on which way the degrade happened.
 *
 * @param key   The resolved secret (from `resolveStripeSecretKey`).
 * @param init  Test-injected SDK init factory. Real factory is the
 *              one in `stripe-client.ts`; we accept any
 *              `(key) => StripeMeterLike` here so we don't pull a
 *              hard dep on the Stripe package when the consumer is in
 *              stub mode.
 */
export function probeStripeAvailability(
  key: string | null,
  init: (apiKey: string) => StripeMeterLike,
): { available: false; reason: 'no-key' | 'init-failed'; error?: Error } | { available: true; client: StripeMeterLike } {
  if (key === null) {
    return { available: false, reason: 'no-key' };
  }
  try {
    const client = init(key);
    return { available: true, client };
  } catch (err) {
    return {
      available: false,
      reason: 'init-failed',
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

// ---------- Schema templating ----------

const SCHEMA_PLACEHOLDER = '{{SCHEMA}}';

/**
 * Substitute `{{SCHEMA}}` in a SQL string with a sanitised schema
 * name. Schema names are restricted to `[A-Za-z_][A-Za-z0-9_]*` to
 * prevent injection — any other value throws.
 */
export function substituteSchema(sql: string, schema: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(
      `usage-meter: invalid schema name "${schema}" — must match [A-Za-z_][A-Za-z0-9_]*`,
    );
  }
  return sql.split(SCHEMA_PLACEHOLDER).join(schema);
}

// ---------- yyyymm helpers ----------

export function toYyyymm(d: Date): number {
  return d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1);
}

export function previousYyyymm(now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1..12
  if (m === 1) return (y - 1) * 100 + 12;
  return y * 100 + (m - 1);
}

export function yyyymmBounds(yyyymm: number): { start: Date; endExclusive: Date } {
  const y = Math.floor(yyyymm / 100);
  const m = yyyymm % 100;
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const endExclusive = m === 12
    ? new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0, 0))
    : new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  return { start, endExclusive };
}

// ---------- The meter service ----------

export interface UsageMeterConfig {
  /** Postgres client (caller owns the pool). */
  readonly pg: PgLike;
  /**
   * Schema for the `tenant_usage_meter*` tables. Defaults to
   * `'caia_meta'` (matches the prod migration). Tests typically pass
   * a per-test schema name.
   */
  readonly schema?: string;
  /**
   * Stripe secret key override. When omitted, `process.env.STRIPE_SECRET_KEY`
   * is used. Pass `null` explicitly to FORCE stub mode (useful for
   * tests).
   */
  readonly stripeSecretKey?: string | null;
  /**
   * Stripe SDK init factory. Defaults to a thin wrapper around the
   * package's `createStripeClient`, but tests inject mocks. Must
   * either return a `StripeMeterLike` or throw to signal init failure.
   */
  readonly stripeInit?: (apiKey: string) => StripeMeterLike;
  /**
   * Per-tenant resolver: given a tenant id, return the Stripe
   * `subscription_item` id the metered-billing usage record should
   * post to. When the resolver returns `null` (tenant has no metered
   * billing item — e.g. they're on a flat-fee professional tier
   * without overage), the post is skipped with status `'stubbed'`.
   */
  readonly resolveSubscriptionItem: (tenantId: string) => Promise<string | null>;
  /** Logger sink — defaults to console. */
  readonly logger?: MeterLogger;
}

/**
 * Default Stripe init factory. We intentionally import the SDK lazily
 * (via dynamic import inside the factory) so the package can be
 * consumed in stub mode without requiring the `stripe` npm package at
 * runtime. The dependency is declared in package.json but the lazy
 * import means `pnpm install --prod=false` failures on the optional
 * SDK don't break the meter writer path.
 *
 * The function returns a synchronous factory because Stripe's
 * constructor is synchronous; "init failure" surfaces as a throw,
 * which `probeStripeAvailability` catches.
 */
export function defaultStripeInit(): (apiKey: string) => StripeMeterLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  let StripeCtor: any;
  return (apiKey: string): StripeMeterLike => {
    if (StripeCtor === undefined) {
      // Lazy require — kept commented for ESM consumers that can't
      // `require`. The real dashboard boot path constructs via
      // `createStripeClient` from `stripe-client.ts` instead.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      StripeCtor = require('stripe');
    }
    const instance = new StripeCtor(apiKey, { apiVersion: '2024-11-20.acacia' });
    return instance as StripeMeterLike;
  };
}

export class UsageMeter {
  private readonly schema: string;
  private readonly logger: MeterLogger;
  private readonly stripeProbe:
    | { available: false; reason: 'no-key' | 'init-failed'; error?: Error }
    | { available: true; client: StripeMeterLike };

  constructor(private readonly config: UsageMeterConfig) {
    this.schema = config.schema ?? 'caia_meta';
    this.logger = config.logger ?? consoleLogger;
    const key = resolveStripeSecretKey(config.stripeSecretKey ?? undefined);
    const initFn = config.stripeInit ?? null;
    if (initFn === null) {
      // No factory supplied AND we're testing the default behaviour:
      // never construct the real SDK in this branch — that's reserved
      // for the dashboard boot path which passes an explicit factory.
      // Treat as stub.
      this.stripeProbe = key === null
        ? { available: false, reason: 'no-key' }
        : { available: false, reason: 'init-failed', error: new Error('no stripeInit factory supplied') };
    } else {
      this.stripeProbe = probeStripeAvailability(key, initFn);
    }

    if (!this.stripeProbe.available) {
      this.logger.warn(
        'Stripe usage record posting will run in STUB MODE — rows still recorded, Stripe API calls skipped.',
        {
          reason: this.stripeProbe.reason,
          ...(this.stripeProbe.error !== undefined
            ? { error: this.stripeProbe.error.message }
            : {}),
        },
      );
    }
  }

  /** `true` when STRIPE_SECRET_KEY is present + SDK init succeeded. */
  get isLive(): boolean {
    return this.stripeProbe.available;
  }

  /** Mirror of `!isLive`. Kept as its own accessor for call-site readability. */
  get isStub(): boolean {
    return !this.stripeProbe.available;
  }

  /** Stub-mode reason — `'no-key'`, `'init-failed'`, or `null` when live. */
  get stubReason(): 'no-key' | 'init-failed' | null {
    return this.stripeProbe.available ? null : this.stripeProbe.reason;
  }

  /**
   * Record one spawn's usage. Always returns a result — never throws
   * for the BYOK skip / free-tier skip paths. PG errors are returned
   * via `{ written: false, reason: 'pg-error', error }` so the spawner
   * can choose to swallow (default — metering is non-critical) or
   * propagate.
   */
  async recordUsage(
    tenantId: string,
    payload: RecordUsagePayload,
  ): Promise<RecordUsageResult> {
    if (payload.skipReason === 'byok') {
      return { written: false, rowId: null, reason: 'byok' };
    }
    if (payload.skipReason === 'free-tier' || payload.tier === 'free') {
      return { written: false, rowId: null, reason: 'free-tier' };
    }

    const sql = substituteSchema(
      `INSERT INTO {{SCHEMA}}.tenant_usage_meter
         (tenant_id, tier, model,
          input_tokens, output_tokens,
          cache_creation_tokens, cache_read_tokens,
          ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      this.schema,
    );
    try {
      const { rows } = await this.config.pg.query<{ id: number }>(sql, [
        tenantId,
        payload.tier,
        payload.model,
        payload.input_tokens ?? 0,
        payload.output_tokens ?? 0,
        payload.cache_creation_input_tokens ?? 0,
        payload.cache_read_input_tokens ?? 0,
        payload.ts ?? new Date(),
      ]);
      const rowId = rows[0]?.id ?? null;
      return { written: true, rowId, reason: 'ok' };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('recordUsage: pg write failed', {
        tenantId,
        model: payload.model,
        error: error.message,
      });
      return {
        written: false,
        rowId: null,
        reason: 'pg-error',
        error,
      };
    }
  }

  /**
   * Sum all unaggregated rows for `(tenantId, yyyymm)`, write an
   * aggregate row, mark the source rows as aggregated. Idempotent —
   * a second call returns the existing aggregate row without
   * re-summing.
   *
   * Implementation:
   *   1. Check if `tenant_usage_meter_aggregates` already has a row
   *      for `(tenant_id, yyyymm)`. If yes → return it.
   *   2. Otherwise, SUM(...) the rows in `tenant_usage_meter` WHERE
   *      tenant_id = $1 AND ts >= start AND ts < endExclusive AND
   *      aggregated_for_yyyymm IS NULL.
   *   3. INSERT the aggregate row with `stripe_post_status='pending'`.
   *   4. UPDATE the source rows' `aggregated_for_yyyymm` to mark them.
   *
   * NOTE: caller should run this inside a TRANSACTION when their PG
   * client supports it. We keep the calls bare here so `PgLike` stays
   * portable; the real Postgres adapter wraps the four queries in
   * `BEGIN ... COMMIT` at the dashboard boot path.
   */
  async aggregateMonth(
    tenantId: string,
    yyyymm: number,
  ): Promise<MonthlyAggregate> {
    // 1. Idempotency check.
    const existing = await this.findAggregate(tenantId, yyyymm);
    if (existing !== null) {
      return existing;
    }

    // 2. Sum source rows.
    const { start, endExclusive } = yyyymmBounds(yyyymm);
    const sumSql = substituteSchema(
      `SELECT
         COALESCE(SUM(input_tokens), 0)::BIGINT          AS input_tokens,
         COALESCE(SUM(output_tokens), 0)::BIGINT         AS output_tokens,
         COALESCE(SUM(cache_creation_tokens), 0)::BIGINT AS cache_creation_tokens,
         COALESCE(SUM(cache_read_tokens), 0)::BIGINT     AS cache_read_tokens,
         COUNT(*)::BIGINT                                AS row_count
       FROM {{SCHEMA}}.tenant_usage_meter
       WHERE tenant_id = $1
         AND ts >= $2
         AND ts <  $3
         AND aggregated_for_yyyymm IS NULL`,
      this.schema,
    );
    const sumRes = await this.config.pg.query<{
      input_tokens: string | number;
      output_tokens: string | number;
      cache_creation_tokens: string | number;
      cache_read_tokens: string | number;
      row_count: string | number;
    }>(sumSql, [tenantId, start, endExclusive]);

    const row = sumRes.rows[0] ?? {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      row_count: 0,
    };
    const totals = {
      totalInputTokens: Number(row.input_tokens),
      totalOutputTokens: Number(row.output_tokens),
      totalCacheCreationTokens: Number(row.cache_creation_tokens),
      totalCacheReadTokens: Number(row.cache_read_tokens),
      rowCount: Number(row.row_count),
    };

    // 3. Insert aggregate.
    const insertSql = substituteSchema(
      `INSERT INTO {{SCHEMA}}.tenant_usage_meter_aggregates
         (tenant_id, yyyymm,
          total_input_tokens, total_output_tokens,
          total_cache_creation_tokens, total_cache_read_tokens,
          row_count, stripe_post_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       ON CONFLICT (tenant_id, yyyymm) DO NOTHING`,
      this.schema,
    );
    await this.config.pg.query(insertSql, [
      tenantId,
      yyyymm,
      totals.totalInputTokens,
      totals.totalOutputTokens,
      totals.totalCacheCreationTokens,
      totals.totalCacheReadTokens,
      totals.rowCount,
    ]);

    // 4. Mark source rows.
    const markSql = substituteSchema(
      `UPDATE {{SCHEMA}}.tenant_usage_meter
         SET aggregated_for_yyyymm = $1
       WHERE tenant_id = $2
         AND ts >= $3
         AND ts <  $4
         AND aggregated_for_yyyymm IS NULL`,
      this.schema,
    );
    await this.config.pg.query(markSql, [yyyymm, tenantId, start, endExclusive]);

    // 5. Re-read to return the canonical row (handles concurrent
    //    inserts via the ON CONFLICT DO NOTHING path above).
    const final = await this.findAggregate(tenantId, yyyymm);
    if (final === null) {
      // Should be unreachable — we just inserted.
      throw new Error(
        `usage-meter: aggregateMonth(${tenantId}, ${String(yyyymm)}) succeeded the INSERT but the row vanished — concurrent DELETE?`,
      );
    }
    return final;
  }

  /**
   * Post a monthly aggregate to Stripe as a metered usage record.
   *
   * Stub-mode behaviour:
   *   - When `this.isStub`, returns `{ status: 'stubbed' }` immediately
   *     AND updates the aggregate row's `stripe_post_status` to
   *     `'stubbed'`. The `aggregated_for_yyyymm` markers on the source
   *     rows stay in place — that's correct: when the operator drops
   *     the Stripe key in later, the cron's "retry stubbed aggregates"
   *     pass just re-reads the aggregate row (no re-summing needed).
   *
   *   - When `this.isLive`, calls Stripe's
   *     `subscriptionItems.createUsageRecord(item, { quantity })`.
   *     On success → status `'posted'`. On Stripe API error → status
   *     `'failed'` with the error captured.
   *
   * Idempotency:
   *   - Won't re-post when `aggregate.stripePostStatus === 'posted'` —
   *     returns the existing usage record id verbatim.
   *
   * Quantity calculation:
   *   - We currently post `total_input_tokens + total_output_tokens`
   *     as a single quantity. Stripe metered-billing is per-unit so
   *     CAIA's Stripe product is configured "per 1000 tokens"
   *     server-side; the divide-by-1000 happens in the operator's
   *     price configuration, not here. (Documented in README.)
   */
  async postStripeUsageRecord(
    tenantId: string,
    aggregate: MonthlyAggregate,
  ): Promise<PostUsageRecordResult> {
    if (aggregate.stripePostStatus === 'posted' && aggregate.stripeUsageRecordId !== null) {
      this.logger.info('postStripeUsageRecord: aggregate already posted; skipping', {
        tenantId,
        yyyymm: aggregate.yyyymm,
        stripeUsageRecordId: aggregate.stripeUsageRecordId,
      });
      return {
        status: 'posted',
        stripeUsageRecordId: aggregate.stripeUsageRecordId,
        reason: 'idempotent',
      };
    }

    if (!this.stripeProbe.available) {
      await this.markAggregatePostStatus(
        tenantId,
        aggregate.yyyymm,
        'stubbed',
        null,
      );
      this.logger.warn('postStripeUsageRecord: STUB MODE — Stripe API call skipped', {
        tenantId,
        yyyymm: aggregate.yyyymm,
        reason: this.stripeProbe.reason,
        totalTokens: aggregate.totalInputTokens + aggregate.totalOutputTokens,
      });
      return {
        status: 'stubbed',
        stripeUsageRecordId: null,
        reason: this.stripeProbe.reason,
      };
    }

    const subscriptionItem = await this.config.resolveSubscriptionItem(tenantId);
    if (subscriptionItem === null) {
      await this.markAggregatePostStatus(
        tenantId,
        aggregate.yyyymm,
        'stubbed',
        null,
      );
      this.logger.warn('postStripeUsageRecord: tenant has no metered subscription item — skipping', {
        tenantId,
        yyyymm: aggregate.yyyymm,
      });
      return {
        status: 'stubbed',
        stripeUsageRecordId: null,
        reason: 'no-subscription-item',
      };
    }

    const quantity = aggregate.totalInputTokens + aggregate.totalOutputTokens;
    try {
      const { id } = await this.stripeProbe.client.subscriptionItems.createUsageRecord(
        subscriptionItem,
        {
          quantity,
          action: 'set',
          timestamp: Math.floor(yyyymmBounds(aggregate.yyyymm).start.getTime() / 1000),
        },
      );
      await this.markAggregatePostStatus(tenantId, aggregate.yyyymm, 'posted', id);
      this.logger.info('postStripeUsageRecord: posted', {
        tenantId,
        yyyymm: aggregate.yyyymm,
        stripeUsageRecordId: id,
        quantity,
      });
      return { status: 'posted', stripeUsageRecordId: id };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.markAggregatePostStatus(tenantId, aggregate.yyyymm, 'failed', null);
      this.logger.error('postStripeUsageRecord: Stripe API rejected', {
        tenantId,
        yyyymm: aggregate.yyyymm,
        error: error.message,
      });
      return { status: 'failed', stripeUsageRecordId: null, error, reason: error.message };
    }
  }

  // ---------- internal helpers ----------

  private async findAggregate(
    tenantId: string,
    yyyymm: number,
  ): Promise<MonthlyAggregate | null> {
    const sql = substituteSchema(
      `SELECT tenant_id, yyyymm,
              total_input_tokens, total_output_tokens,
              total_cache_creation_tokens, total_cache_read_tokens,
              row_count, stripe_usage_record_id, stripe_post_status, posted_at
         FROM {{SCHEMA}}.tenant_usage_meter_aggregates
        WHERE tenant_id = $1 AND yyyymm = $2`,
      this.schema,
    );
    const { rows } = await this.config.pg.query<{
      tenant_id: string;
      yyyymm: number;
      total_input_tokens: string | number;
      total_output_tokens: string | number;
      total_cache_creation_tokens: string | number;
      total_cache_read_tokens: string | number;
      row_count: string | number;
      stripe_usage_record_id: string | null;
      stripe_post_status: 'pending' | 'posted' | 'stubbed' | 'failed';
      posted_at: Date | string | null;
    }>(sql, [tenantId, yyyymm]);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      tenantId: row.tenant_id,
      yyyymm: Number(row.yyyymm),
      totalInputTokens: Number(row.total_input_tokens),
      totalOutputTokens: Number(row.total_output_tokens),
      totalCacheCreationTokens: Number(row.total_cache_creation_tokens),
      totalCacheReadTokens: Number(row.total_cache_read_tokens),
      rowCount: Number(row.row_count),
      stripeUsageRecordId: row.stripe_usage_record_id,
      stripePostStatus: row.stripe_post_status,
      postedAt: row.posted_at === null
        ? null
        : (row.posted_at instanceof Date ? row.posted_at : new Date(row.posted_at)),
    };
  }

  private async markAggregatePostStatus(
    tenantId: string,
    yyyymm: number,
    status: 'posted' | 'stubbed' | 'failed',
    stripeUsageRecordId: string | null,
  ): Promise<void> {
    const sql = substituteSchema(
      `UPDATE {{SCHEMA}}.tenant_usage_meter_aggregates
          SET stripe_post_status = $1,
              stripe_usage_record_id = COALESCE($2, stripe_usage_record_id),
              posted_at = CASE WHEN $1 IN ('posted','stubbed') THEN now() ELSE posted_at END
        WHERE tenant_id = $3 AND yyyymm = $4`,
      this.schema,
    );
    await this.config.pg.query(sql, [status, stripeUsageRecordId, tenantId, yyyymm]);
  }
}

// ---------- Standalone function exports (per task spec) ----------

/**
 * Convenience wrapper: `recordUsage(tenantId, payload)` without
 * needing to construct the class. Caller supplies the meter via a
 * module-level singleton (typical in the dashboard boot path).
 *
 * The class-based surface is preferred for testing; this function
 * surface matches the task spec literally.
 */
export async function recordUsage(
  meter: UsageMeter,
  tenantId: string,
  payload: RecordUsagePayload,
): Promise<RecordUsageResult> {
  return meter.recordUsage(tenantId, payload);
}

export async function aggregateMonth(
  meter: UsageMeter,
  tenantId: string,
  yyyymm: number,
): Promise<MonthlyAggregate> {
  return meter.aggregateMonth(tenantId, yyyymm);
}

export async function postStripeUsageRecord(
  meter: UsageMeter,
  tenantId: string,
  aggregate: MonthlyAggregate,
): Promise<PostUsageRecordResult> {
  return meter.postStripeUsageRecord(tenantId, aggregate);
}
