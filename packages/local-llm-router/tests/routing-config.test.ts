import { describe, it, expect } from 'vitest';
import {
  getRoute,
  ROUTING_RULES,
  COST_ANALYSIS,
} from '../src/routing-config.js';
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

    it('falls back to a Claude-default rule for unknown task types', () => {
      const rule = getRoute('totally-made-up-task');
      expect(rule.taskType).toBe('totally-made-up-task');
      expect(rule.useLocal).toBe(false);
      expect(rule.claudeModel).toBe('claude-sonnet-4-6');
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
      for (const rule of ROUTING_RULES) {
        if (rule.useLocal && rule.taskType !== 'embedding-generation') {
          // Embedding has no Claude analogue (we never call Anthropic for
          // text-embedding generation); every other local-first rule does.
          expect(
            rule.claudeModel,
            `local-first rule "${rule.taskType}" missing Claude fallback`,
          ).toBeDefined();
        }
      }
    });
  });
});
