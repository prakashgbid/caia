import { describe, it, expect } from 'vitest';
import {
  getRoute,
  ROUTING_RULES,
  COST_ANALYSIS,
} from '../src/routing-config.js';

describe('routing-config', () => {
  describe('ROUTING_RULES', () => {
    it('contains rules for the documented task types', () => {
      const types = ROUTING_RULES.map((r) => r.taskType);
      expect(types).toContain('domain-classification');
      expect(types).toContain('nature-classification');
      expect(types).toContain('story-enrichment');
      expect(types).toContain('hierarchy-decomposition');
      expect(types).toContain('architecture-decision');
      expect(types).toContain('code-implementation-complex');
      expect(types).toContain('security-review');
    });

    it('routes simple classification tasks to local', () => {
      const rule = ROUTING_RULES.find(
        (r) => r.taskType === 'domain-classification',
      );
      expect(rule?.useLocal).toBe(true);
    });

    it('routes complex reasoning tasks to Claude', () => {
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

    it('every rule defines a maxTokens budget', () => {
      for (const rule of ROUTING_RULES) {
        expect(rule.maxTokens).toBeGreaterThan(0);
      }
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
});
