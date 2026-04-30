/**
 * Cost computation — translates Anthropic API response usage headers
 * into a USD figure.
 */

import { DEFAULT_MODEL_COSTS, type ModelCost } from './types.js';

export interface UsageBlock {
  /** Anthropic's `usage.input_tokens`. */
  input_tokens: number;
  /** Anthropic's `usage.output_tokens`. */
  output_tokens: number;
  /** Optional cache-creation tokens (priced as input). */
  cache_creation_input_tokens?: number;
  /** Optional cache-read tokens (priced at 10% of input). */
  cache_read_input_tokens?: number;
}

/**
 * Compute USD cost for a single API response. Cache-creation tokens are
 * priced as regular input; cache-read tokens are priced at 10%.
 */
export function computeCostUsd(
  model: string,
  usage: UsageBlock,
  costMap: Readonly<Record<string, ModelCost>> = DEFAULT_MODEL_COSTS,
): number {
  const rate = costMap[model] ?? costMap['_default'];
  if (!rate) return 0;
  const inputBilled =
    usage.input_tokens + (usage.cache_creation_input_tokens ?? 0);
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const inputCost = (inputBilled / 1_000_000) * rate.inputUsdPerMillion;
  const cacheReadCost =
    (cacheRead / 1_000_000) * (rate.inputUsdPerMillion * 0.1);
  const outputCost = (usage.output_tokens / 1_000_000) * rate.outputUsdPerMillion;
  return Number((inputCost + cacheReadCost + outputCost).toFixed(6));
}

/**
 * Estimate the USD cost of an upcoming request before the response
 * arrives — used for pre-flight cap checks. Pessimistic by design:
 * assumes the maxTokens budget will be fully spent on output.
 */
export function estimateRequestCostUsd(opts: {
  model: string;
  promptTokens: number;
  maxOutputTokens: number;
  costMap?: Readonly<Record<string, ModelCost>>;
}): number {
  const map = opts.costMap ?? DEFAULT_MODEL_COSTS;
  const rate = map[opts.model] ?? map['_default'];
  if (!rate) return 0;
  return Number(
    (
      (opts.promptTokens / 1_000_000) * rate.inputUsdPerMillion +
      (opts.maxOutputTokens / 1_000_000) * rate.outputUsdPerMillion
    ).toFixed(6),
  );
}
