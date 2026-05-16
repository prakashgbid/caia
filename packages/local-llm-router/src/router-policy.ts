// Router policy resolvers (GB-12, 2026-05-15).
//
// Lifts the {tier, intent} → {model, timeout_ms} lookup out of the HTTP server
// so that:
//   1. The race between this phase (GB-12) and sps-router-critical-fixes R-2
//      is bounded to ONE import line in server.ts. Heavy logic lives here.
//   2. The mapping is driven purely from `config/routing-rules.yaml`'s
//      `tier_models` block — no code edit is needed when an ollama tag rotates.
//   3. Tests can import the resolver directly without standing up a Hono app.
//
// The resolver is intentionally tolerant of partial config:
//   - tier absent from `tier_models` → returns null model + null timeout
//   - intent absent from `per_intent` → falls back to `default_model`
//   - all blank → null/null
//
// Callers MUST handle a null model (a `tier_models` block was never loaded /
// was malformed / the recommended tier is one with no configured backend).

import type {
  IntentResultV2,
  RoutingRules,
  TierModelConfig,
} from './classifier-v2.js';
import type { Intent, IntentResult, RecommendedTier } from './classifier.js';

export interface TierResolution {
  /** Ollama tag selected for this tier+intent, or null if the tier has no model config. */
  model: string | null;
  /** Per-request CPU latency budget in ms, or null if the tier has no timeout config. */
  timeout_ms: number | null;
  /** True when the model came from a `per_intent` override (vs the tier default). */
  intent_override: boolean;
}

const EMPTY: TierResolution = {
  model: null,
  timeout_ms: null,
  intent_override: false,
};

/**
 * Resolve `{tier, intent}` → `{model, timeout_ms}` against the loaded
 * `tier_models` block in routing-rules.yaml.
 *
 * Pass `intent = null` to skip the per-intent lookup entirely (caller wants
 * the tier default, e.g. for a /healthz-style probe).
 */
export function resolveTierModel(
  rules: RoutingRules,
  tier: RecommendedTier,
  intent: Intent | null,
): TierResolution {
  const cfg: TierModelConfig | undefined = rules.tier_models[tier];
  if (cfg === undefined) return EMPTY;

  let model: string | null = null;
  let intent_override = false;
  if (intent !== null) {
    const override = cfg.per_intent[intent];
    if (override !== undefined && override.length > 0) {
      model = override;
      intent_override = true;
    }
  }
  if (model === null && cfg.default_model.length > 0) {
    model = cfg.default_model;
  }

  const timeout_ms = cfg.timeout_ms > 0 ? cfg.timeout_ms : null;
  return { model, timeout_ms, intent_override };
}

/** Convenience: resolve directly from a classifier result. */
export function resolveFromIntent(
  rules: RoutingRules,
  result: IntentResult | IntentResultV2,
): TierResolution {
  return resolveTierModel(rules, result.recommended_tier, result.intent);
}
