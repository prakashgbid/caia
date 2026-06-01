/**
 * `claude-spawner-meter-hook.ts` — bridge between
 * `@chiefaia/claude-spawner`'s post-spawn `UsageMeterHook` signature
 * and `@caia/billing`'s `UsageMeter.recordUsage`.
 *
 * Why this lives in `@caia/billing` (not the spawner):
 *   - The spawner is upstream of billing in the dep graph; if it
 *     imported `@caia/billing` we'd create a cycle.
 *   - The hook signature is duck-typed structurally so we don't even
 *     need a `@chiefaia/claude-spawner` import for type-checking —
 *     the consumer wires the two packages together at boot, and the
 *     spawner accepts the closure verbatim.
 *
 * BYOK gate:
 *   - The hook accepts an optional `secretsAdapter` + `provider`
 *     (default `'anthropic'`). When supplied, the hook calls
 *     `secretsAdapter.list(tenantId, 'runtime_credits')` to detect a
 *     BYOK runtime key, and short-circuits with `skipReason='byok'`
 *     before the meter write. This is the "BYOK tenants bypass the
 *     meter" rule from the task spec.
 *   - When the secretsAdapter is omitted the hook trusts the caller's
 *     `ctx.skipReason` field.
 */

import { runtimeKeyName, RUNTIME_KEY_CATEGORY, type ByokProvider } from './types.js';
import type { UsageMeter } from './usage-meter.js';

/**
 * Minimal duck-typed shape mirroring `@chiefaia/claude-spawner`'s
 * `UsageMeterContext`. Redeclared here to avoid an upstream dep.
 */
export interface MeterHookContext {
  readonly tenantId: string;
  readonly tier: 'free' | 'professional' | 'team';
  readonly model: string;
  readonly skipReason?: 'byok' | 'free-tier' | null;
}

/**
 * The payload shape `@chiefaia/claude-spawner` produces from the
 * envelope's `usage` field. Redeclared structurally so this file does
 * not import from the spawner package.
 */
export interface MeterHookPayload {
  readonly model: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens: number;
  readonly cache_read_input_tokens: number;
  readonly ts: Date;
}

/**
 * The slim secrets-adapter surface this hook uses to detect BYOK.
 * Mirrors `@caia/secrets-adapter.SecretsAdapter.list(...)` so the
 * caller can hand in the real adapter at boot.
 *
 * `hasRuntimeKey(tenantId, provider)` is the spec-canonical method
 * name. When the adapter exposes that directly (newer versions),
 * call sites can pass `{ hasRuntimeKey: secrets.hasRuntimeKey.bind(secrets) }`
 * verbatim. Otherwise we synthesise the same answer from `.list`.
 */
export interface ByokDetector {
  hasRuntimeKey(tenantId: string, provider: ByokProvider): Promise<boolean>;
}

/**
 * Default detector built atop the v0.x secrets-adapter `.list()`
 * surface. Returns true iff the runtime-credits category contains a
 * key named `<provider>_api_key`.
 */
export function detectorFromListSurface(
  list: (tenantId: string, category?: string) => Promise<Array<{ key: string }>>,
): ByokDetector {
  return {
    async hasRuntimeKey(tenantId: string, provider: ByokProvider): Promise<boolean> {
      try {
        const metas = await list(tenantId, RUNTIME_KEY_CATEGORY);
        const target = runtimeKeyName(provider);
        return metas.some((m) => m.key === target);
      } catch {
        // Defensive: a failing adapter must NOT meter unconditionally;
        // we treat "we don't know" as "skip metering" to err on the
        // side of not double-billing the tenant.
        return true;
      }
    },
  };
}

export interface CreateClaudeSpawnerMeterHookOptions {
  /** The meter the hook delegates to. */
  readonly meter: UsageMeter;
  /**
   * Optional BYOK detector. When supplied, the hook calls
   * `detector.hasRuntimeKey(tenantId, provider)` before each meter
   * write and skips the write when the tenant is BYOK.
   */
  readonly byokDetector?: ByokDetector;
  /**
   * Which provider to check for BYOK. Default `'anthropic'` (the
   * only provider CAIA's Claude calls use today).
   */
  readonly byokProvider?: ByokProvider;
}

/**
 * Build a `UsageMeterHook`-shaped closure suitable for handing to
 * `spawnClaude({ usageMeterHook })`.
 *
 * The closure:
 *   1. Honours `ctx.skipReason === 'byok' | 'free-tier'` — short-circuits.
 *   2. Calls `byokDetector.hasRuntimeKey(tenantId, provider)` when a
 *      detector is supplied; on `true`, short-circuits with
 *      `skipReason: 'byok'`.
 *   3. Otherwise delegates to `meter.recordUsage(tenantId, payload)`.
 *
 * Returns a function compatible with `@chiefaia/claude-spawner`'s
 * `UsageMeterHook` type — duck-typing means no import is needed.
 */
export function createClaudeSpawnerMeterHook(
  opts: CreateClaudeSpawnerMeterHookOptions,
): (ctx: MeterHookContext, payload: MeterHookPayload) => Promise<void> {
  const provider: ByokProvider = opts.byokProvider ?? 'anthropic';

  return async (ctx: MeterHookContext, payload: MeterHookPayload): Promise<void> => {
    // Trust caller-supplied skip reasons.
    if (ctx.skipReason === 'byok') {
      await opts.meter.recordUsage(ctx.tenantId, {
        model: payload.model,
        input_tokens: payload.input_tokens,
        output_tokens: payload.output_tokens,
        cache_creation_input_tokens: payload.cache_creation_input_tokens,
        cache_read_input_tokens: payload.cache_read_input_tokens,
        ts: payload.ts,
        tier: ctx.tier,
        skipReason: 'byok',
      });
      return;
    }
    if (ctx.skipReason === 'free-tier' || ctx.tier === 'free') {
      await opts.meter.recordUsage(ctx.tenantId, {
        model: payload.model,
        input_tokens: payload.input_tokens,
        output_tokens: payload.output_tokens,
        cache_creation_input_tokens: payload.cache_creation_input_tokens,
        cache_read_input_tokens: payload.cache_read_input_tokens,
        ts: payload.ts,
        tier: ctx.tier,
        skipReason: 'free-tier',
      });
      return;
    }

    // Run the BYOK detector if supplied. Skip the meter on true.
    if (opts.byokDetector !== undefined) {
      const byok = await opts.byokDetector.hasRuntimeKey(ctx.tenantId, provider);
      if (byok) {
        await opts.meter.recordUsage(ctx.tenantId, {
          model: payload.model,
          input_tokens: payload.input_tokens,
          output_tokens: payload.output_tokens,
          cache_creation_input_tokens: payload.cache_creation_input_tokens,
          cache_read_input_tokens: payload.cache_read_input_tokens,
          ts: payload.ts,
          tier: ctx.tier,
          skipReason: 'byok',
        });
        return;
      }
    }

    await opts.meter.recordUsage(ctx.tenantId, {
      model: payload.model,
      input_tokens: payload.input_tokens,
      output_tokens: payload.output_tokens,
      cache_creation_input_tokens: payload.cache_creation_input_tokens,
      cache_read_input_tokens: payload.cache_read_input_tokens,
      ts: payload.ts,
      tier: ctx.tier,
    });
  };
}
