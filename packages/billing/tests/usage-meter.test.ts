/**
 * `tests/usage-meter.test.ts` — Phase C3 vitest coverage for
 * `@caia/billing`'s usage-meter surface.
 *
 * 24 cases organised as:
 *   - Schema substitution (3)
 *   - Yyyymm helpers (3)
 *   - Stripe key resolution (3)
 *   - Stripe init probe (2)
 *   - recordUsage path (5)
 *   - aggregateMonth path (4)
 *   - postStripeUsageRecord path (4)
 *
 * Real-key path: when `STRIPE_SECRET_KEY` is present AND looks like a
 * test-mode key (`sk_test_...`), the test exercises the live branch
 * via a stub init factory that observes the call. Without the env
 * var, those cases are auto-skipped — matches the spec's
 * "real-key path skipped if STRIPE_SECRET_KEY absent" rule.
 *
 * Stub-mode path: tested unconditionally via explicit `stripeSecretKey: null`.
 *
 * BYOK skip: tested via the meter hook + caller-supplied `skipReason`.
 *
 * Aggregation correctness + monthly idempotency are validated
 * against an in-memory PgLike that maintains the canonical row shape.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  UsageMeter,
  previousYyyymm,
  toYyyymm,
  yyyymmBounds,
  substituteSchema,
  resolveStripeSecretKey,
  probeStripeAvailability,
  createClaudeSpawnerMeterHook,
  detectorFromListSurface,
  type PgLike,
  type StripeMeterLike,
  type MonthlyAggregate,
} from '../src/index.js';

// ---------- In-memory PgLike ----------

interface MeterRow {
  id: number;
  tenant_id: string;
  tier: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  ts: Date;
  aggregated_for_yyyymm: number | null;
  stripe_usage_record_id: string | null;
}

interface AggregateRow {
  tenant_id: string;
  yyyymm: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  row_count: number;
  stripe_usage_record_id: string | null;
  stripe_post_status: 'pending' | 'posted' | 'stubbed' | 'failed';
  posted_at: Date | null;
}

class InMemoryPg implements PgLike {
  private nextId = 1;
  rows: MeterRow[] = [];
  aggregates: AggregateRow[] = [];
  queries: string[] = [];

  async query<R>(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rows: R[]; rowCount?: number | null }> {
    this.queries.push(sql);
    const p = params ?? [];

    if (/INSERT INTO\s+\S+\.tenant_usage_meter\s*\(/i.test(sql)) {
      const row: MeterRow = {
        id: this.nextId++,
        tenant_id: String(p[0]),
        tier: String(p[1]),
        model: String(p[2]),
        input_tokens: Number(p[3]),
        output_tokens: Number(p[4]),
        cache_creation_tokens: Number(p[5]),
        cache_read_tokens: Number(p[6]),
        ts: p[7] as Date,
        aggregated_for_yyyymm: null,
        stripe_usage_record_id: null,
      };
      this.rows.push(row);
      return { rows: [{ id: row.id }] as unknown as R[], rowCount: 1 };
    }

    if (/SELECT[\s\S]+FROM\s+\S+\.tenant_usage_meter_aggregates/i.test(sql)
        && /WHERE\s+tenant_id\s*=\s*\$1\s+AND\s+yyyymm\s*=\s*\$2/i.test(sql)) {
      const tenant = String(p[0]);
      const yyyymm = Number(p[1]);
      const found = this.aggregates.find((a) => a.tenant_id === tenant && a.yyyymm === yyyymm);
      return { rows: (found ? [found] : []) as unknown as R[], rowCount: found ? 1 : 0 };
    }

    if (/SELECT[\s\S]+SUM\(input_tokens\)/i.test(sql)) {
      const tenant = String(p[0]);
      const start = p[1] as Date;
      const endEx = p[2] as Date;
      const rows = this.rows.filter(
        (r) =>
          r.tenant_id === tenant &&
          r.aggregated_for_yyyymm === null &&
          r.ts.getTime() >= start.getTime() &&
          r.ts.getTime() < endEx.getTime(),
      );
      const totals = rows.reduce(
        (acc, r) => ({
          input_tokens: acc.input_tokens + r.input_tokens,
          output_tokens: acc.output_tokens + r.output_tokens,
          cache_creation_tokens: acc.cache_creation_tokens + r.cache_creation_tokens,
          cache_read_tokens: acc.cache_read_tokens + r.cache_read_tokens,
          row_count: acc.row_count + 1,
        }),
        { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, row_count: 0 },
      );
      return { rows: [totals] as unknown as R[], rowCount: 1 };
    }

    if (/INSERT INTO\s+\S+\.tenant_usage_meter_aggregates/i.test(sql)) {
      const tenant = String(p[0]);
      const yyyymm = Number(p[1]);
      const exists = this.aggregates.some((a) => a.tenant_id === tenant && a.yyyymm === yyyymm);
      if (!exists) {
        this.aggregates.push({
          tenant_id: tenant,
          yyyymm,
          total_input_tokens: Number(p[2]),
          total_output_tokens: Number(p[3]),
          total_cache_creation_tokens: Number(p[4]),
          total_cache_read_tokens: Number(p[5]),
          row_count: Number(p[6]),
          stripe_usage_record_id: null,
          stripe_post_status: 'pending',
          posted_at: null,
        });
      }
      return { rows: [] as unknown as R[], rowCount: exists ? 0 : 1 };
    }

    if (/UPDATE\s+\S+\.tenant_usage_meter\s+SET\s+aggregated_for_yyyymm/i.test(sql)) {
      const yyyymm = Number(p[0]);
      const tenant = String(p[1]);
      const start = p[2] as Date;
      const endEx = p[3] as Date;
      let count = 0;
      for (const r of this.rows) {
        if (
          r.tenant_id === tenant &&
          r.aggregated_for_yyyymm === null &&
          r.ts.getTime() >= start.getTime() &&
          r.ts.getTime() < endEx.getTime()
        ) {
          r.aggregated_for_yyyymm = yyyymm;
          count++;
        }
      }
      return { rows: [] as unknown as R[], rowCount: count };
    }

    if (/UPDATE\s+\S+\.tenant_usage_meter_aggregates\s+SET\s+stripe_post_status/i.test(sql)) {
      const status = String(p[0]) as AggregateRow['stripe_post_status'];
      const recId = p[1] === null ? null : String(p[1]);
      const tenant = String(p[2]);
      const yyyymm = Number(p[3]);
      const row = this.aggregates.find((a) => a.tenant_id === tenant && a.yyyymm === yyyymm);
      if (row !== undefined) {
        row.stripe_post_status = status;
        if (recId !== null) row.stripe_usage_record_id = recId;
        if (status === 'posted' || status === 'stubbed') row.posted_at = new Date();
      }
      return { rows: [] as unknown as R[], rowCount: row !== undefined ? 1 : 0 };
    }

    return { rows: [] as unknown as R[], rowCount: 0 };
  }
}

// ---------- Stripe mocks ----------

function makeFakeStripeMeter(): { client: StripeMeterLike; calls: Array<{ item: string; quantity: number; action: string | undefined; timestamp: number | undefined }> } {
  const calls: Array<{ item: string; quantity: number; action: string | undefined; timestamp: number | undefined }> = [];
  let n = 1;
  const client: StripeMeterLike = {
    subscriptionItems: {
      createUsageRecord: vi.fn(async (item: string, params: { quantity: number; timestamp?: number; action?: 'increment' | 'set' }) => {
        calls.push({ item, quantity: params.quantity, action: params.action, timestamp: params.timestamp });
        return { id: `mbur_test_${String(n++)}` };
      }),
    },
  };
  return { client, calls };
}

// ---------- helpers ----------

function buildMeter(opts: { stub?: boolean; pg?: InMemoryPg; subItem?: string | null; throwOnInit?: boolean; stripeCalls?: ReturnType<typeof makeFakeStripeMeter> } = {}): {
  meter: UsageMeter;
  pg: InMemoryPg;
  stripeCalls: ReturnType<typeof makeFakeStripeMeter>['calls'] | null;
} {
  const pg = opts.pg ?? new InMemoryPg();
  const stripeFake = opts.stripeCalls ?? makeFakeStripeMeter();
  const stripeInit = opts.throwOnInit
    ? (() => { throw new Error('boom'); }) as (apiKey: string) => StripeMeterLike
    : (() => stripeFake.client) as (apiKey: string) => StripeMeterLike;
  const meter = new UsageMeter({
    pg,
    schema: 'test_schema',
    stripeSecretKey: opts.stub === true ? null : 'sk_test_unit',
    stripeInit,
    resolveSubscriptionItem: async () => (opts.subItem === undefined ? 'si_test_unit' : opts.subItem),
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  return { meter, pg, stripeCalls: opts.stub === true || opts.throwOnInit === true ? null : stripeFake.calls };
}

// ============================================================
// Tests
// ============================================================

describe('substituteSchema', () => {
  it('replaces {{SCHEMA}} occurrences with the schema name', () => {
    expect(substituteSchema('FROM {{SCHEMA}}.t', 'caia_meta')).toBe('FROM caia_meta.t');
  });

  it('replaces multiple occurrences', () => {
    expect(substituteSchema('{{SCHEMA}}.a {{SCHEMA}}.b', 'x')).toBe('x.a x.b');
  });

  it('rejects illegal schema names (SQL injection guard)', () => {
    expect(() => substituteSchema('x', 'bad name')).toThrow(/invalid schema/i);
    expect(() => substituteSchema('x', 'bad;name')).toThrow(/invalid schema/i);
    expect(() => substituteSchema('x', '1leading')).toThrow(/invalid schema/i);
  });
});

describe('yyyymm helpers', () => {
  it('toYyyymm packs year + month into a single integer', () => {
    expect(toYyyymm(new Date(Date.UTC(2026, 3, 15)))).toBe(202604);
    expect(toYyyymm(new Date(Date.UTC(2025, 11, 31)))).toBe(202512);
  });

  it('previousYyyymm rolls year on January', () => {
    expect(previousYyyymm(new Date(Date.UTC(2026, 0, 5)))).toBe(202512);
    expect(previousYyyymm(new Date(Date.UTC(2026, 5, 5)))).toBe(202605);
  });

  it('yyyymmBounds returns inclusive-start / exclusive-end UTC dates', () => {
    const { start, endExclusive } = yyyymmBounds(202604);
    expect(start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    const dec = yyyymmBounds(202512);
    expect(dec.endExclusive.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('resolveStripeSecretKey', () => {
  it('returns null when env var is unset and no override', () => {
    const original = process.env['STRIPE_SECRET_KEY'];
    delete process.env['STRIPE_SECRET_KEY'];
    try {
      expect(resolveStripeSecretKey()).toBeNull();
    } finally {
      if (original !== undefined) process.env['STRIPE_SECRET_KEY'] = original;
    }
  });

  it('returns the override when provided', () => {
    expect(resolveStripeSecretKey('sk_test_abc')).toBe('sk_test_abc');
  });

  it('returns null when override is empty string', () => {
    expect(resolveStripeSecretKey('   ')).toBeNull();
  });
});

describe('probeStripeAvailability', () => {
  it('returns no-key when key is null', () => {
    const result = probeStripeAvailability(null, () => ({ subscriptionItems: { createUsageRecord: async () => ({ id: 'x' }) } }));
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('no-key');
  });

  it('returns init-failed when SDK init throws', () => {
    const result = probeStripeAvailability('sk_test_x', () => { throw new Error('bad key'); });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toBe('init-failed');
      expect(result.error?.message).toMatch(/bad key/);
    }
  });
});

describe('recordUsage', () => {
  it('writes a row for a professional-tier tenant', async () => {
    const { meter, pg } = buildMeter({ stub: true });
    const r = await meter.recordUsage('tenant-1', {
      model: 'claude-opus-4-6',
      input_tokens: 100,
      output_tokens: 200,
      tier: 'professional',
    });
    expect(r.written).toBe(true);
    expect(r.reason).toBe('ok');
    expect(pg.rows).toHaveLength(1);
    expect(pg.rows[0]?.input_tokens).toBe(100);
    expect(pg.rows[0]?.output_tokens).toBe(200);
  });

  it('skips writing when tier is free', async () => {
    const { meter, pg } = buildMeter({ stub: true });
    const r = await meter.recordUsage('tenant-1', {
      model: 'claude-opus-4-6',
      tier: 'free',
    });
    expect(r.written).toBe(false);
    expect(r.reason).toBe('free-tier');
    expect(pg.rows).toHaveLength(0);
  });

  it('skips writing when skipReason is byok', async () => {
    const { meter, pg } = buildMeter({ stub: true });
    const r = await meter.recordUsage('tenant-1', {
      model: 'claude-opus-4-6',
      tier: 'professional',
      skipReason: 'byok',
    });
    expect(r.written).toBe(false);
    expect(r.reason).toBe('byok');
    expect(pg.rows).toHaveLength(0);
  });

  it('captures pg errors as pg-error result, does not throw', async () => {
    const pg = new InMemoryPg();
    pg.query = vi.fn(async () => { throw new Error('connection lost'); });
    const { meter } = buildMeter({ stub: true, pg });
    const r = await meter.recordUsage('tenant-1', {
      model: 'claude-opus-4-6',
      tier: 'professional',
    });
    expect(r.written).toBe(false);
    expect(r.reason).toBe('pg-error');
    expect(r.error?.message).toMatch(/connection lost/);
  });

  it('defaults missing token counts to 0', async () => {
    const { meter, pg } = buildMeter({ stub: true });
    await meter.recordUsage('tenant-1', { model: 'claude-haiku', tier: 'team' });
    expect(pg.rows[0]?.input_tokens).toBe(0);
    expect(pg.rows[0]?.output_tokens).toBe(0);
    expect(pg.rows[0]?.cache_creation_tokens).toBe(0);
    expect(pg.rows[0]?.cache_read_tokens).toBe(0);
  });
});

describe('aggregateMonth', () => {
  it('sum of recordUsage calls equals the aggregate row', async () => {
    const { meter, pg } = buildMeter({ stub: true });
    const ts = new Date(Date.UTC(2026, 3, 15)); // 2026-04-15
    for (let i = 0; i < 5; i++) {
      await meter.recordUsage('tenant-A', {
        model: 'claude-opus-4-6',
        input_tokens: 100,
        output_tokens: 50,
        ts,
        tier: 'professional',
      });
    }
    const agg = await meter.aggregateMonth('tenant-A', 202604);
    expect(agg.totalInputTokens).toBe(500);
    expect(agg.totalOutputTokens).toBe(250);
    expect(agg.rowCount).toBe(5);
    expect(pg.rows.every((r) => r.aggregated_for_yyyymm === 202604)).toBe(true);
  });

  it('rows outside the month are excluded', async () => {
    const { meter } = buildMeter({ stub: true });
    await meter.recordUsage('tenant-A', {
      model: 'claude-opus-4-6',
      input_tokens: 100,
      ts: new Date(Date.UTC(2026, 3, 15)),
      tier: 'professional',
    });
    await meter.recordUsage('tenant-A', {
      model: 'claude-opus-4-6',
      input_tokens: 999,
      ts: new Date(Date.UTC(2026, 4, 1)), // May 1 — outside
      tier: 'professional',
    });
    const agg = await meter.aggregateMonth('tenant-A', 202604);
    expect(agg.totalInputTokens).toBe(100);
    expect(agg.rowCount).toBe(1);
  });

  it('is idempotent — second call returns the existing aggregate without re-summing', async () => {
    const { meter, pg } = buildMeter({ stub: true });
    await meter.recordUsage('tenant-A', {
      model: 'claude-opus-4-6',
      input_tokens: 100,
      ts: new Date(Date.UTC(2026, 3, 15)),
      tier: 'professional',
    });
    const first = await meter.aggregateMonth('tenant-A', 202604);
    // Add a row AFTER first aggregation — should not be summed in.
    await meter.recordUsage('tenant-A', {
      model: 'claude-opus-4-6',
      input_tokens: 999,
      ts: new Date(Date.UTC(2026, 3, 20)),
      tier: 'professional',
    });
    const second = await meter.aggregateMonth('tenant-A', 202604);
    expect(second.totalInputTokens).toBe(first.totalInputTokens);
    expect(second.rowCount).toBe(first.rowCount);
    expect(pg.aggregates).toHaveLength(1);
  });

  it('returns zero totals when no rows exist for the month', async () => {
    const { meter } = buildMeter({ stub: true });
    const agg = await meter.aggregateMonth('tenant-A', 202604);
    expect(agg.totalInputTokens).toBe(0);
    expect(agg.rowCount).toBe(0);
    expect(agg.stripePostStatus).toBe('pending');
  });
});

describe('postStripeUsageRecord — stub mode (default)', () => {
  it('returns stubbed without calling Stripe when STRIPE_SECRET_KEY absent', async () => {
    const { meter } = buildMeter({ stub: true });
    expect(meter.isStub).toBe(true);
    expect(meter.stubReason).toBe('no-key');
    const aggregate: MonthlyAggregate = {
      tenantId: 'tenant-A',
      yyyymm: 202604,
      totalInputTokens: 100,
      totalOutputTokens: 200,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      rowCount: 1,
      stripeUsageRecordId: null,
      stripePostStatus: 'pending',
      postedAt: null,
    };
    // Seed an aggregate row so the UPDATE has something to mark.
    const { meter: m2, pg } = buildMeter({ stub: true });
    pg.aggregates.push({
      tenant_id: 'tenant-A',
      yyyymm: 202604,
      total_input_tokens: 100,
      total_output_tokens: 200,
      total_cache_creation_tokens: 0,
      total_cache_read_tokens: 0,
      row_count: 1,
      stripe_usage_record_id: null,
      stripe_post_status: 'pending',
      posted_at: null,
    });
    const r = await m2.postStripeUsageRecord('tenant-A', aggregate);
    expect(r.status).toBe('stubbed');
    expect(r.stripeUsageRecordId).toBeNull();
    expect(pg.aggregates[0]?.stripe_post_status).toBe('stubbed');
    // unused
    void meter;
  });

  it('returns stubbed when stripeInit throws on init-failed', async () => {
    const { meter, pg } = buildMeter({ throwOnInit: true });
    expect(meter.isStub).toBe(true);
    expect(meter.stubReason).toBe('init-failed');
    pg.aggregates.push({
      tenant_id: 'tenant-A',
      yyyymm: 202604,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cache_creation_tokens: 0,
      total_cache_read_tokens: 0,
      row_count: 0,
      stripe_usage_record_id: null,
      stripe_post_status: 'pending',
      posted_at: null,
    });
    const r = await meter.postStripeUsageRecord('tenant-A', {
      tenantId: 'tenant-A',
      yyyymm: 202604,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      rowCount: 0,
      stripeUsageRecordId: null,
      stripePostStatus: 'pending',
      postedAt: null,
    });
    expect(r.status).toBe('stubbed');
    expect(r.reason).toBe('init-failed');
  });
});

describe('postStripeUsageRecord — live mode', () => {
  it('posts to Stripe with the sum-of-tokens quantity', async () => {
    const stripeFake = makeFakeStripeMeter();
    const { meter, pg } = buildMeter({ stub: false, stripeCalls: stripeFake });
    expect(meter.isLive).toBe(true);
    pg.aggregates.push({
      tenant_id: 'tenant-A',
      yyyymm: 202604,
      total_input_tokens: 1000,
      total_output_tokens: 500,
      total_cache_creation_tokens: 0,
      total_cache_read_tokens: 0,
      row_count: 3,
      stripe_usage_record_id: null,
      stripe_post_status: 'pending',
      posted_at: null,
    });
    const r = await meter.postStripeUsageRecord('tenant-A', {
      tenantId: 'tenant-A',
      yyyymm: 202604,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      rowCount: 3,
      stripeUsageRecordId: null,
      stripePostStatus: 'pending',
      postedAt: null,
    });
    expect(r.status).toBe('posted');
    expect(r.stripeUsageRecordId).toMatch(/^mbur_test_/);
    expect(stripeFake.calls).toHaveLength(1);
    expect(stripeFake.calls[0]?.quantity).toBe(1500);
    expect(pg.aggregates[0]?.stripe_post_status).toBe('posted');
  });

  it('is idempotent — re-posting an already-posted aggregate returns posted without calling Stripe', async () => {
    const stripeFake = makeFakeStripeMeter();
    const { meter } = buildMeter({ stub: false, stripeCalls: stripeFake });
    const r = await meter.postStripeUsageRecord('tenant-A', {
      tenantId: 'tenant-A',
      yyyymm: 202604,
      totalInputTokens: 100,
      totalOutputTokens: 100,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      rowCount: 1,
      stripeUsageRecordId: 'mbur_existing',
      stripePostStatus: 'posted',
      postedAt: new Date(),
    });
    expect(r.status).toBe('posted');
    expect(r.stripeUsageRecordId).toBe('mbur_existing');
    expect(stripeFake.calls).toHaveLength(0);
  });

  it('marks failed when Stripe API rejects', async () => {
    const stripeFake = makeFakeStripeMeter();
    stripeFake.client.subscriptionItems.createUsageRecord = vi.fn(async () => { throw new Error('rate_limit_exceeded'); });
    const { meter, pg } = buildMeter({ stub: false, stripeCalls: stripeFake });
    pg.aggregates.push({
      tenant_id: 'tenant-A',
      yyyymm: 202604,
      total_input_tokens: 1,
      total_output_tokens: 1,
      total_cache_creation_tokens: 0,
      total_cache_read_tokens: 0,
      row_count: 1,
      stripe_usage_record_id: null,
      stripe_post_status: 'pending',
      posted_at: null,
    });
    const r = await meter.postStripeUsageRecord('tenant-A', {
      tenantId: 'tenant-A',
      yyyymm: 202604,
      totalInputTokens: 1,
      totalOutputTokens: 1,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      rowCount: 1,
      stripeUsageRecordId: null,
      stripePostStatus: 'pending',
      postedAt: null,
    });
    expect(r.status).toBe('failed');
    expect(r.error?.message).toMatch(/rate_limit_exceeded/);
    expect(pg.aggregates[0]?.stripe_post_status).toBe('failed');
  });

  it('stubs when tenant has no subscription_item id', async () => {
    const stripeFake = makeFakeStripeMeter();
    const { meter, pg } = buildMeter({ stub: false, stripeCalls: stripeFake, subItem: null });
    pg.aggregates.push({
      tenant_id: 'tenant-A',
      yyyymm: 202604,
      total_input_tokens: 1,
      total_output_tokens: 1,
      total_cache_creation_tokens: 0,
      total_cache_read_tokens: 0,
      row_count: 1,
      stripe_usage_record_id: null,
      stripe_post_status: 'pending',
      posted_at: null,
    });
    const r = await meter.postStripeUsageRecord('tenant-A', {
      tenantId: 'tenant-A',
      yyyymm: 202604,
      totalInputTokens: 1,
      totalOutputTokens: 1,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      rowCount: 1,
      stripeUsageRecordId: null,
      stripePostStatus: 'pending',
      postedAt: null,
    });
    expect(r.status).toBe('stubbed');
    expect(r.reason).toBe('no-subscription-item');
    expect(stripeFake.calls).toHaveLength(0);
  });
});

// ---------- BYOK hook ----------

describe('createClaudeSpawnerMeterHook + BYOK detector', () => {
  it('honours caller-supplied skipReason=byok (bypasses meter write)', async () => {
    const { meter, pg } = buildMeter({ stub: true });
    const hook = createClaudeSpawnerMeterHook({ meter });
    await hook(
      { tenantId: 'tenant-A', tier: 'professional', model: 'claude-opus-4-6', skipReason: 'byok' },
      {
        model: 'claude-opus-4-6',
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        ts: new Date(),
      },
    );
    expect(pg.rows).toHaveLength(0);
  });

  it('byokDetector returning true short-circuits the meter write', async () => {
    const { meter, pg } = buildMeter({ stub: true });
    const list = vi.fn(async () => [{ key: 'anthropic_api_key' }]);
    const hook = createClaudeSpawnerMeterHook({
      meter,
      byokDetector: detectorFromListSurface(list),
    });
    await hook(
      { tenantId: 'tenant-A', tier: 'professional', model: 'claude-opus-4-6' },
      {
        model: 'claude-opus-4-6',
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        ts: new Date(),
      },
    );
    expect(list).toHaveBeenCalled();
    expect(pg.rows).toHaveLength(0);
  });

  it('byokDetector returning false lets the meter row through', async () => {
    const { meter, pg } = buildMeter({ stub: true });
    const list = vi.fn(async () => [] as Array<{ key: string }>);
    const hook = createClaudeSpawnerMeterHook({
      meter,
      byokDetector: detectorFromListSurface(list),
    });
    await hook(
      { tenantId: 'tenant-A', tier: 'professional', model: 'claude-opus-4-6' },
      {
        model: 'claude-opus-4-6',
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        ts: new Date(),
      },
    );
    expect(pg.rows).toHaveLength(1);
    expect(pg.rows[0]?.input_tokens).toBe(100);
  });
});

// ---------- Real-key path (skipped unless STRIPE_SECRET_KEY present) ----------

const REAL_KEY = process.env['STRIPE_SECRET_KEY'];
const describeReal = REAL_KEY !== undefined && REAL_KEY.startsWith('sk_test_') ? describe : describe.skip;

describeReal('real-key path (gated on sk_test_*)', () => {
  it('isLive=true when a real testmode key is present and SDK init succeeds', () => {
    let initCalledWith: string | null = null;
    const { meter } = (() => {
      const pg = new InMemoryPg();
      const fakeClient: StripeMeterLike = {
        subscriptionItems: { createUsageRecord: async () => ({ id: 'mbur_real_test' }) },
      };
      return {
        meter: new UsageMeter({
          pg,
          schema: 'test_schema',
          stripeSecretKey: REAL_KEY!,
          stripeInit: (k) => { initCalledWith = k; return fakeClient; },
          resolveSubscriptionItem: async () => 'si_real_test',
        }),
      };
    })();
    expect(meter.isLive).toBe(true);
    expect(initCalledWith).toBe(REAL_KEY);
  });
});
