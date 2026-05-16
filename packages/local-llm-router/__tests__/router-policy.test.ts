// GB-12 (2026-05-15) — tier-model resolver tests.
//
// Verifies:
//   1. `tier_models` is parsed from the on-disk routing-rules.yaml.
//   2. `resolveTierModel` returns the per-intent override when present.
//   3. Returns the tier default when an intent is unmapped.
//   4. Returns null/null when the tier has no `tier_models` entry.
//   5. The stolution-batch tier is non-empty for `batch-summarize` (the
//      directive's acceptance criterion).

import { describe, expect, it } from 'vitest';

import {
  __resetRulesCache,
  loadRoutingRules,
  parseRoutingRulesYaml,
  type RoutingRules,
} from '../src/classifier-v2.js';
import { resolveTierModel } from '../src/router-policy.js';

describe('router-policy: resolveTierModel (GB-12)', () => {
  describe('against the shipped routing-rules.yaml', () => {
    it('stolution-batch tier is non-empty for batch-summarize intent', () => {
      // Reset the YAML cache so we read the freshly-edited file from disk.
      __resetRulesCache();
      const rules = loadRoutingRules();
      const res = resolveTierModel(rules, 'stolution-batch', 'batch-summarize');
      // Directive: qwen2.5-coder:14b for batch-summarize / corpus-distill.
      expect(res.model).toBe('qwen2.5-coder:14b');
      expect(res.intent_override).toBe(true);
      // 5-min CPU latency budget per the directive.
      expect(res.timeout_ms).toBe(300_000);
    });

    it('stolution-batch tier maps corpus-distill to qwen2.5-coder:14b', () => {
      __resetRulesCache();
      const rules = loadRoutingRules();
      const res = resolveTierModel(rules, 'stolution-batch', 'corpus-distill');
      expect(res.model).toBe('qwen2.5-coder:14b');
      expect(res.intent_override).toBe(true);
    });

    it('stolution-batch tier maps long-context-reason to qwen2.5-coder:32b', () => {
      __resetRulesCache();
      const rules = loadRoutingRules();
      const res = resolveTierModel(rules, 'stolution-batch', 'long-context-reason');
      expect(res.model).toBe('qwen2.5-coder:32b');
      expect(res.intent_override).toBe(true);
    });

    it('stolution-batch tier maps complex-review to llama3.3:70b', () => {
      __resetRulesCache();
      const rules = loadRoutingRules();
      const res = resolveTierModel(rules, 'stolution-batch', 'complex-review');
      expect(res.model).toBe('llama3.3:70b');
      expect(res.intent_override).toBe(true);
    });

    it('stolution-batch falls back to the tier default for unmapped intents', () => {
      __resetRulesCache();
      const rules = loadRoutingRules();
      // `summarize` is a local-7b intent — it has no stolution-batch override,
      // but the resolver still returns the tier default (llama3.3:70b) so a
      // forced-route-to-stolution-batch path has a valid model to dispatch to.
      const res = resolveTierModel(rules, 'stolution-batch', 'summarize');
      expect(res.model).toBe('llama3.3:70b');
      expect(res.intent_override).toBe(false);
      expect(res.timeout_ms).toBe(300_000);
    });

    it('returns null/null for tiers with no tier_models entry', () => {
      __resetRulesCache();
      const rules = loadRoutingRules();
      // `local-7b` has no `tier_models` entry — the routing-config.ts task-type
      // path picks the model. Verify resolveTierModel returns nulls (and the
      // caller is expected to fall through to ROUTING_RULES).
      const res = resolveTierModel(rules, 'local-7b', 'summarize');
      expect(res.model).toBeNull();
      expect(res.timeout_ms).toBeNull();
      expect(res.intent_override).toBe(false);
    });
  });

  describe('against an in-memory rules document', () => {
    const RULES: RoutingRules = {
      version: 2,
      default_confidence_threshold: 0.6,
      escalation_threshold: 0.5,
      cascade_thresholds: { 'stolution-batch': 0.5, claude: 0.0 },
      tier_order: ['stolution-batch', 'claude'],
      intents: [],
      tier_models: {
        'stolution-batch': {
          timeout_ms: 300_000,
          default_model: 'llama3.3:70b',
          per_intent: {
            'batch-summarize': 'qwen2.5-coder:14b',
          },
        },
      },
    };

    it('passes intent=null to skip the per-intent lookup', () => {
      const res = resolveTierModel(RULES, 'stolution-batch', null);
      expect(res.model).toBe('llama3.3:70b');
      expect(res.intent_override).toBe(false);
    });

    it('parser tolerates an empty tier_models block', () => {
      const yaml = `
version: 2
default_confidence_threshold: 0.6
escalation_threshold: 0.5
cascade_thresholds:
  claude: 0.0
tier_order:
  - claude
tier_models:
intents:
  - name: unknown
    default_tier: claude
    min_confidence: 0.0
    keywords: []
`;
      const parsed = parseRoutingRulesYaml(yaml);
      expect(parsed.tier_models).toEqual({});
    });

    it('parser captures the per_intent map from YAML', () => {
      const yaml = `
version: 2
default_confidence_threshold: 0.6
escalation_threshold: 0.5
cascade_thresholds:
  stolution-batch: 0.5
  claude: 0.0
tier_order:
  - stolution-batch
  - claude
tier_models:
  stolution-batch:
    timeout_ms: 300000
    default_model: llama3.3:70b
    per_intent:
      batch-summarize: qwen2.5-coder:14b
      corpus-distill: qwen2.5-coder:14b
intents:
  - name: batch-summarize
    default_tier: stolution-batch
    min_confidence: 0.5
    keywords:
      - batch summarize
  - name: unknown
    default_tier: claude
    min_confidence: 0.0
    keywords: []
`;
      const parsed = parseRoutingRulesYaml(yaml);
      const sb = parsed.tier_models['stolution-batch'];
      expect(sb).toBeDefined();
      expect(sb?.timeout_ms).toBe(300_000);
      expect(sb?.default_model).toBe('llama3.3:70b');
      expect(sb?.per_intent['batch-summarize']).toBe('qwen2.5-coder:14b');
      expect(sb?.per_intent['corpus-distill']).toBe('qwen2.5-coder:14b');
    });
  });
});
