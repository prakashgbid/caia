/**
 * Cost computation — Anthropic usage headers → USD.
 */

import { describe, it, expect } from 'vitest';
import {
  computeCostUsd,
  estimateRequestCostUsd,
  DEFAULT_MODEL_COSTS,
} from '../src/index.js';

describe('computeCostUsd', () => {
  it('charges sonnet at $3/$15 per 1M tokens', () => {
    const cost = computeCostUsd('claude-sonnet-4-6', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost).toBe(18); // 3 + 15
  });

  it('charges opus at $15/$75 per 1M tokens', () => {
    const cost = computeCostUsd('claude-opus-4-7', {
      input_tokens: 100_000,
      output_tokens: 100_000,
    });
    // 0.1 * 15 + 0.1 * 75 = 9
    expect(cost).toBe(9);
  });

  it('prices cache-creation tokens as input', () => {
    const cost = computeCostUsd('claude-sonnet-4-6', {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
    });
    expect(cost).toBe(3);
  });

  it('prices cache-read tokens at 10% of input rate', () => {
    const cost = computeCostUsd('claude-sonnet-4-6', {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.3, 5); // 10% of $3
  });

  it('falls back to _default for unknown models', () => {
    const cost = computeCostUsd('totally-fake-model', {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    expect(cost).toBe(DEFAULT_MODEL_COSTS['_default']!.inputUsdPerMillion);
  });
});

describe('estimateRequestCostUsd', () => {
  it('uses the maxOutputTokens budget pessimistically', () => {
    const est = estimateRequestCostUsd({
      model: 'claude-sonnet-4-6',
      promptTokens: 1_000_000,
      maxOutputTokens: 1_000_000,
    });
    expect(est).toBe(18);
  });
  it('treats unknown models with default sonnet rates', () => {
    const est = estimateRequestCostUsd({
      model: 'unknown',
      promptTokens: 1_000_000,
      maxOutputTokens: 0,
    });
    expect(est).toBe(3);
  });
});
