import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';
import {
  getRoute,
  ROUTING_RULES,
  COST_ANALYSIS,
  TIER_EXPECTATIONS,
  verifyTierRouting,
} from '../src/routing-config.js';
import { INTENT_VALUES } from '../src/classifier.js';
import { getModel } from '../src/model-catalog.js';

describe('routing-config', () => {
  describe('ROUTING_RULES', () => {
    it('contains rules for the documented task types', () => {
      const types = ROUTING_RULES.map((r) => r.taskType);
      // Pre-LAI-005 baseline rules are still present.
      expect(types).toContain('domain-classification');
      expect(types).toContain('nature-classification');
      expect(types).toContain('story-enrichment');
      expect(types).toContain('hierarchy-decomposition');
      expect(types).toContain('architecture-decision');
      expect(types).toContain('code-implementation-complex');
      expect(types).toContain('security-review');
    });

    it('contains the LAI-005 newly-promoted local task types', () => {
      const types = ROUTING_RULES.map((r) => r.taskType);
      // Generative tasks now backed by 14B-class models on the local path.
      expect(types).toContain('commit-message');
      expect(types).toContain('pr-summary');
      expect(types).toContain('code-explanation');
      expect(types).toContain('code-review-light');
      expect(types).toContain('requirement-deduplication');
      expect(types).toContain('formal-reasoning');
      expect(types).toContain('hierarchy-decomposition-rough');
    });

    it('routes simple classification tasks to local', () => {
      const rule = ROUTING_RULES.find(
        (r) => r.taskType === 'domain-classification',
      );
      expect(rule?.useLocal).toBe(true);
    });

    it('keeps high-stakes reasoning on Claude', () => {
      const complexTypes = [
        'hierarchy-decomposition',
        'architecture-decision',
        'code-implementation-complex',
        'security-review',
      ];
      for (const t of complexTypes) {
        const rule = ROUTING_RULES.find((r) => r.taskType === t);
        expect(rule?.useLocal).toBe(false);
      }
    });

    it('routes story-enrichment to local', () => {
      const rule = ROUTING_RULES.find((r) => r.taskType === 'story-enrichment');
      expect(rule?.useLocal).toBe(true);
    });

    it('LAI-005 first-pass tasks route local with a Claude fallback', () => {
      const localFirstPass = [
        'code-review-light',
        'formal-reasoning',
        'hierarchy-decomposition-rough',
      ];
      for (const t of localFirstPass) {
        const rule = ROUTING_RULES.find((r) => r.taskType === t);
        expect(rule?.useLocal).toBe(true);
        expect(rule?.claudeModel).toBeDefined();
      }
    });

    it('every local model in the rule table is in MODEL_CATALOG', () => {
      // Belt-and-braces: a typo in a localModel field would silently fall
      // back to /api/generate at runtime instead of using the right
      // endpoint. Surfacing it as a unit failure is far cheaper.
      for (const rule of ROUTING_RULES) {
        expect(
          getModel(rule.localModel),
          `routing rule "${rule.taskType}" references unknown local model "${rule.localModel}"`,
        ).toBeDefined();
      }
    });

    it('every rule defines a maxTokens budget', () => {
      for (const rule of ROUTING_RULES) {
        expect(rule.maxTokens).toBeGreaterThan(0);
      }
    });

    it('uses unique task types', () => {
      const types = ROUTING_RULES.map((r) => r.taskType);
      expect(new Set(types).size).toBe(types.length);
    });

    it('formal-reasoning routes to phi4 (the math/STEM specialist)', () => {
      const rule = ROUTING_RULES.find((r) => r.taskType === 'formal-reasoning');
      expect(rule?.localModel).toBe('phi4');
      expect(rule?.useLocal).toBe(true);
    });
  });

  describe('getRoute', () => {
    it('returns the matching rule for a known task type', () => {
      const rule = getRoute('domain-classification');
      expect(rule.taskType).toBe('domain-classification');
      expect(rule.useLocal).toBe(true);
    });

    it('falls back to a Local-default rule for unknown task types (LAI-002 follow-up 2026-04-30)', () => {
      // Default flipped from useLocal:false to useLocal:true on 2026-04-30
      // because the binary-spawn ClaudeAdapter has ~6-10s session-init
      // overhead per call. Unregistered classification tasks (validation-*,
      // etc.) bottlenecked the pipeline at the 180s timeout; defaulting to
      // local Ollama makes them snappy and free.
      const rule = getRoute('totally-made-up-task');
      expect(rule.taskType).toBe('totally-made-up-task');
      expect(rule.useLocal).toBe(true);
      expect(rule.claudeModel).toBe('claude-sonnet-4-6');
      expect(rule.localModel).toBe('qwen2.5-coder:7b');
    });
  });

  describe('COST_ANALYSIS', () => {
    it('exposes the documented cost-savings projection', () => {
      expect(COST_ANALYSIS.withoutLocalLLM).toBeDefined();
      expect(COST_ANALYSIS.withLocalLLM).toBeDefined();
      expect(COST_ANALYSIS.estimatedSavings).toBeDefined();
      expect(COST_ANALYSIS.breakEven).toBeDefined();
    });
  });

  describe('B1 silent tier-collapse fix (2026-05-15)', () => {
    // Minimal YAML loader scoped to the intent/default_tier pairs we need.
    // Mirrors the parser in classifier-v2 but trimmed to the two fields the
    // verifyTierRouting() contract cares about.
    function loadIntentsFromYaml(): { name: string; default_tier: string }[] {
      const yamlPath = resolve(
        new URL('.', import.meta.url).pathname,
        '..',
        'config',
        'routing-rules.yaml',
      );
      const text = readFileSync(yamlPath, 'utf8');
      const intents: { name: string; default_tier: string }[] = [];
      let cur: { name?: string; default_tier?: string } = {};
      for (const line of text.split('\n')) {
        const mName = line.match(/^\s*-\s*name:\s*(.+)$/);
        if (mName) {
          if (cur.name && cur.default_tier) {
            intents.push({ name: cur.name, default_tier: cur.default_tier });
          }
          cur = { name: mName[1].trim() };
          continue;
        }
        const mTier = line.match(/^\s*default_tier:\s*(.+)$/);
        if (mTier && cur.name) cur.default_tier = mTier[1].trim();
      }
      if (cur.name && cur.default_tier) {
        intents.push({ name: cur.name, default_tier: cur.default_tier });
      }
      return intents;
    }

    it('every classifier-v2 intent is registered as a routing-config taskType', () => {
      const intents = loadIntentsFromYaml();
      // Sanity: YAML parsed something (drift guard).
      expect(intents.length).toBeGreaterThan(20);
      // RR-2 (2026-05-16): `unknown` used to be excluded here because it had
      // no routing rule and the dispatcher fell through to qwen2.5-coder:7b.
      // That fall-through *was* the displacement-bias bug — closing the gap
      // means `unknown` is now a first-class taskType (default_tier=claude)
      // and the filter is no longer needed.
      const missing = intents
        .filter((i) => ROUTING_RULES.find((r) => r.taskType === i.name) === undefined);
      expect(
        missing,
        `classifier-v2 intents missing routing-config rules (silent tier-collapse risk): ` +
          missing.map((m) => `${m.name} (tier=${m.default_tier})`).join(', '),
      ).toEqual([]);
    });

    it('verifyTierRouting() returns no violations for the current taxonomy', () => {
      const intents = loadIntentsFromYaml();
      const violations = verifyTierRouting(intents);
      // Format the failure message so a regression names the exact intent
      // and the model it silently collapsed to.
      expect(
        violations,
        violations.length === 0
          ? 'ok'
          : 'tier-routing violations:\n' +
              violations
                .map(
                  (v) =>
                    `  - ${v.intent} (tier=${v.expectedTier}, reason=${v.reason}): ` +
                    `expected ${v.expectedModel}/${v.expectedUseLocal ? 'local' : 'claude'}, ` +
                    `got ${v.actualModel ?? '<no-rule>'}/${
                      v.actualUseLocal === undefined ? '?' : v.actualUseLocal ? 'local' : 'claude'
                    }`,
                )
                .join('\n'),
      ).toEqual([]);
    });

    it('per-tier asserts: every local-14b intent serves 14b (no silent collapse to 7b)', () => {
      const intents = loadIntentsFromYaml();
      const fourteenB = intents.filter((i) => i.default_tier === 'local-14b');
      // Sanity: there are some local-14b intents in the taxonomy.
      expect(fourteenB.length).toBeGreaterThan(0);
      for (const intent of fourteenB) {
        const rule = ROUTING_RULES.find((r) => r.taskType === intent.name);
        expect(
          rule,
          `local-14b intent "${intent.name}" has no routing-config rule — ` +
            `getRoute() will fall through to qwen2.5-coder:7b (silent tier-collapse)`,
        ).toBeDefined();
        expect(
          rule?.localModel,
          `local-14b intent "${intent.name}" routes to ${rule?.localModel} ` +
            `instead of qwen2.5-coder:14b (silent tier-collapse)`,
        ).toBe('qwen2.5-coder:14b');
      }
    });

    it('per-tier asserts: every local-32b intent serves a 14B-class model (32b doesn\'t fit on M1 Pro)', () => {
      const intents = loadIntentsFromYaml();
      const thirtyTwoB = intents.filter((i) => i.default_tier === 'local-32b');
      expect(thirtyTwoB.length).toBeGreaterThan(0);
      // 14B-class models accepted for local-32b fallback. qwen3:14b is a
      // deliberate generalist choice for `architecture-review`; the cascade
      // tier (local-32b) is preserved by the model size class even though
      // the tag differs from TIER_EXPECTATIONS['local-32b'].
      const fourteenBFallbacks = new Set([
        'qwen2.5-coder:14b',
        'qwen3:14b',
        'phi4',
      ]);
      for (const intent of thirtyTwoB) {
        const rule = ROUTING_RULES.find((r) => r.taskType === intent.name);
        expect(rule, `local-32b intent "${intent.name}" missing rule`).toBeDefined();
        expect(
          fourteenBFallbacks.has(rule!.localModel),
          `local-32b intent "${intent.name}" routes to ${rule!.localModel} — ` +
            `expected a 14B-class fallback (32B doesn't fit on M1 Pro 16GB)`,
        ).toBe(true);
        expect(rule?.useLocal).toBe(true);
        expect(rule?.claudeModel).toBeDefined();
      }
    });

    it('TIER_EXPECTATIONS covers every tier the classifier-v2 YAML uses', () => {
      const intents = loadIntentsFromYaml();
      const tiers = new Set(intents.map((i) => i.default_tier));
      for (const tier of tiers) {
        expect(
          TIER_EXPECTATIONS[tier],
          `classifier-v2 tier "${tier}" has no TIER_EXPECTATIONS entry — ` +
            `verifyTierRouting() will silently skip it`,
        ).toBeDefined();
      }
    });
  });

  describe('RR-2 intent-vocab gap closure (2026-05-16)', () => {
    // Asserts every entry in classifier.ts INTENT_VALUES has a corresponding
    // ROUTING_RULES entry. This is the structural invariant the RR-2 fix
    // institutionalises: when the classifier emits an intent name, the
    // dispatcher MUST find a registered rule for it. The pre-RR-2 bug was
    // that `complex-review` + `unknown` were in INTENT_VALUES but absent
    // from ROUTING_RULES, so getRoute() returned its unknown-task default
    // (qwen2.5-coder:7b, useLocal:true) — silently routing the abstain
    // bucket + the heaviest review intent to local-7b. That same gap can
    // re-open any time a new intent is added to classifier.ts without a
    // matching ROUTING_RULES entry; this test fails when it does.
    it('every INTENT_VALUES entry has a ROUTING_RULES rule', () => {
      const taskTypes = new Set(ROUTING_RULES.map((r) => r.taskType));
      const missing = INTENT_VALUES.filter((intent) => !taskTypes.has(intent));
      expect(
        missing,
        `INTENT_VALUES entries missing from ROUTING_RULES (silent tier-collapse risk): ` +
          missing.join(', '),
      ).toEqual([]);
    });

    it('complex-review routes to claude fallback (stolution-batch tier, useLocal:false)', () => {
      const rule = ROUTING_RULES.find((r) => r.taskType === 'complex-review');
      expect(rule, 'complex-review rule missing — RR-2 regression').toBeDefined();
      expect(rule?.useLocal).toBe(false);
      expect(rule?.claudeModel).toBeDefined();
      // Matches TIER_EXPECTATIONS['stolution-batch'].
      expect(rule?.localModel).toBe('qwen2.5-coder:14b');
    });

    it('unknown abstain bucket routes to claude (not silent local-7b)', () => {
      const rule = ROUTING_RULES.find((r) => r.taskType === 'unknown');
      expect(rule, 'unknown rule missing — RR-2 regression').toBeDefined();
      // The displacement-bias smoking gun: the abstain bucket MUST NOT
      // silently serve qwen2.5-coder:7b. useLocal:false escalates to Claude
      // so /metrics reflects the honest cost of the abstain path.
      expect(rule?.useLocal).toBe(false);
      expect(rule?.claudeModel).toBeDefined();
      expect(rule?.localModel).toBe('qwen2.5-coder:14b');
    });

    it('classifier-emitted `unknown` no longer falls through to the unknown-task default', () => {
      // Pre-RR-2: getRoute('unknown') returned the unknown-task fallback
      //   (qwen2.5-coder:7b, useLocal:true).
      // Post-RR-2: getRoute('unknown') resolves the explicit rule above.
      const rule = getRoute('unknown');
      expect(rule.taskType).toBe('unknown');
      expect(rule.useLocal).toBe(false);
      expect(rule.localModel).toBe('qwen2.5-coder:14b');
      expect(rule.description).not.toMatch(/Unknown task type/i);
    });
  });

  describe('local-share invariants (LAI-005)', () => {
    it('at least 70% of rules route to local by default', () => {
      const total = ROUTING_RULES.length;
      const local = ROUTING_RULES.filter((r) => r.useLocal).length;
      const share = local / total;
      expect(
        share,
        `local share ${(share * 100).toFixed(0)}% should be >=70% after LAI-005`,
      ).toBeGreaterThanOrEqual(0.7);
    });

    it('every local-default rule has a Claude fallback for resilience', () => {
      // Embedding rules have no Claude analogue (we never call Anthropic for
      // text-embedding generation); every other local-first rule does.
      // `embedding-generate` is the B1 classifier-v2 intent alias for the
      // pre-existing `embedding-generation` taskType.
      const noClaudeAnalogue = new Set([
        'embedding-generation',
        'embedding-generate',
      ]);
      for (const rule of ROUTING_RULES) {
        if (rule.useLocal && !noClaudeAnalogue.has(rule.taskType)) {
          expect(
            rule.claudeModel,
            `local-first rule "${rule.taskType}" missing Claude fallback`,
          ).toBeDefined();
        }
      }
    });
  });
});
