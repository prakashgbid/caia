/**
 * `apps/wizard/lib/wizard/claude-meter.ts` — Phase C3 integration
 * point between wizard API routes and `@caia/billing.UsageMeter`.
 *
 * The four wizard step routes (`design/ingest`, `interview/answer`,
 * `interview/complete`, `proposal/generate`) already wrap their
 * Claude calls in `withClaudeSpawnerSpan(...)` (PR #633) and
 * `wizardWithRetry(...)` (PR #631). This helper plugs the meter into
 * that existing stack via two surfaces:
 *
 *   1. `withMeteredWizardClaude({ tenantId, tier, model, ... }, fn)` —
 *      drop-in replacement for `withClaudeSpawnerSpan` that also
 *      writes one `tenant_usage_meter` row per successful claude call.
 *      Internally calls `withClaudeSpawnerSpan` so the existing OTel
 *      attributes are unchanged.
 *
 *   2. `recordWizardClaudeUsage(ctx, envelope)` — for routes that
 *      parse the envelope themselves and want to write the meter row
 *      explicitly (e.g. when a single span issues multiple distinct
 *      prompts and each needs its own meter row).
 *
 * Both surfaces are stub-mode tolerant via the underlying meter:
 * when `STRIPE_SECRET_KEY` is unset the rows still write to PG; the
 * monthly cron handles the Stripe post-or-stub decision.
 *
 * BYOK detection lives in `createClaudeSpawnerMeterHook` and is
 * wired via `@caia/secrets-adapter.list(tenantId, 'runtime_credits')`.
 * When the dashboard hasn't yet wired the adapter, the hook accepts
 * a caller-supplied `skipReason` override.
 *
 * Reuse-first compliance:
 *   - `@caia/billing.UsageMeter` — the canonical meter.
 *   - `@chiefaia/tracing.withClaudeSpawnerSpan` — the canonical span wrapper.
 *   - No re-implementation of token extraction; reuses the spawner's
 *     `ClaudeJsonEnvelope` shape verbatim.
 */

import {
  UsageMeter,
  defaultStripeInit,
  createClaudeSpawnerMeterHook,
  detectorFromListSurface,
  type PgLike,
  type RecordUsageResult,
} from '@caia/billing';
import { withClaudeSpawnerSpan, type WizardClaudeSpanAttributes } from '@chiefaia/tracing';
import type { ClaudeJsonEnvelope } from '@chiefaia/claude-spawner';

/**
 * Lazily-constructed singleton. The dashboard boot path can override
 * via `setWizardClaudeMeter(...)` for tests; in production it lazy-
 * initialises on first call so module load doesn't require a live PG.
 */
let _meter: UsageMeter | null = null;
let _byokList: ((tenantId: string, category?: string) => Promise<Array<{ key: string }>>) | null = null;

export function setWizardClaudeMeter(meter: UsageMeter | null): void {
  _meter = meter;
}

export function setWizardByokListSurface(
  list: ((tenantId: string, category?: string) => Promise<Array<{ key: string }>>) | null,
): void {
  _byokList = list;
}

/**
 * Build a default meter from environment. Tests should call
 * `setWizardClaudeMeter()` instead.
 *
 * Lazy-imports `pg` so unit tests that never call this path don't pay
 * the import cost.
 */
async function defaultMeter(): Promise<UsageMeter> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error('wizard claude-meter: DATABASE_URL env var is required for the default meter.');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = (await import('pg')) as { Pool: new (cfg: { connectionString: string }) => unknown };
  const pool = new Pool({ connectionString: databaseUrl }) as {
    query: <R>(sql: string, params?: ReadonlyArray<unknown>) => Promise<{ rows: R[]; rowCount?: number | null }>;
  };
  const pg: PgLike = {
    query: async <R>(sql: string, params?: ReadonlyArray<unknown>) => pool.query<R>(sql, params),
  };
  return new UsageMeter({
    pg,
    schema: process.env['CAIA_BILLING_SCHEMA'] ?? 'caia_meta',
    stripeInit: defaultStripeInit(),
    resolveSubscriptionItem: async () => null,
  });
}

export async function getWizardClaudeMeter(): Promise<UsageMeter> {
  if (_meter === null) {
    _meter = await defaultMeter();
  }
  return _meter;
}

// ---------- Token extraction ----------

export interface WizardClaudeMeterContext {
  readonly tenantId: string;
  readonly projectId: string;
  readonly tier: 'free' | 'professional' | 'team';
  readonly model: string;
  readonly skipReason?: 'byok' | 'free-tier' | null;
}

export function extractUsageFromEnvelope(envelope: ClaudeJsonEnvelope | undefined): {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
} {
  const u = envelope?.usage ?? {};
  return {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
  };
}

/**
 * Explicit-write helper for routes that parse the envelope themselves.
 * Returns the meter's record result so the route can attach attrs to
 * its span (or swallow).
 */
export async function recordWizardClaudeUsage(
  ctx: WizardClaudeMeterContext,
  envelope: ClaudeJsonEnvelope | undefined,
): Promise<RecordUsageResult> {
  const meter = await getWizardClaudeMeter();
  const usage = extractUsageFromEnvelope(envelope);
  const hook = createClaudeSpawnerMeterHook({
    meter,
    ...(_byokList !== null
      ? { byokDetector: detectorFromListSurface(_byokList) }
      : {}),
  });
  // Build a synthetic payload that mirrors what the spawner would
  // emit if we'd handed it the hook directly. Doing this here lets
  // routes that build their prompt + envelope manually use the same
  // BYOK + meter path.
  let lastResult: RecordUsageResult = {
    written: false,
    rowId: null,
    reason: 'pg-error',
    error: new Error('hook never invoked recordUsage'),
  };
  // Capture by patching the meter's recordUsage transparently.
  const realRecord = meter.recordUsage.bind(meter);
  meter.recordUsage = async (tid, payload) => {
    lastResult = await realRecord(tid, payload);
    return lastResult;
  };
  try {
    await hook(
      {
        tenantId: ctx.tenantId,
        tier: ctx.tier,
        model: ctx.model,
        ...(ctx.skipReason !== undefined ? { skipReason: ctx.skipReason } : {}),
      },
      {
        model: ctx.model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        ts: new Date(),
      },
    );
  } finally {
    meter.recordUsage = realRecord;
  }
  return lastResult;
}

/**
 * Drop-in wrapper that combines `withClaudeSpawnerSpan` and the
 * meter. Routes that already use `withClaudeSpawnerSpan` can swap
 * the import to this helper without other changes.
 *
 * The wrapped `fn` must return either:
 *   - a value of arbitrary type T (e.g. an in-memory store advance
 *     result), in which case `envelopeAccessor` extracts the
 *     envelope from `T` for metering; OR
 *   - a `ClaudeJsonEnvelope` directly (default — pass no accessor).
 *
 * When `envelopeAccessor` returns `undefined` the meter write is
 * skipped silently (treated as "no claude call was actually made
 * this turn" — typical for the V1 in-memory wizard path).
 */
export async function withMeteredWizardClaude<T>(
  attrs: WizardClaudeSpanAttributes & {
    tenantId: string;
    tier: 'free' | 'professional' | 'team';
    skipReason?: 'byok' | 'free-tier' | null;
  },
  fn: () => Promise<T>,
  envelopeAccessor?: (value: T) => ClaudeJsonEnvelope | undefined,
): Promise<T> {
  return withClaudeSpawnerSpan(attrs, async () => {
    const value = await fn();
    const envelope = envelopeAccessor !== undefined
      ? envelopeAccessor(value)
      : (value as unknown as ClaudeJsonEnvelope | undefined);
    if (envelope !== undefined && attrs.model !== undefined) {
      try {
        await recordWizardClaudeUsage(
          {
            tenantId: attrs.tenantId,
            projectId: attrs.projectId ?? 'unknown',
            tier: attrs.tier,
            model: attrs.model,
            ...(attrs.skipReason !== undefined ? { skipReason: attrs.skipReason } : {}),
          },
          envelope,
        );
      } catch {
        // Metering is non-critical; never fail the route on a
        // meter PG hiccup.
      }
    }
    return value;
  });
}
