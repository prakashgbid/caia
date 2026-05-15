import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetRulesCache,
  classifyV2,
  keywordPrepass,
  loadRoutingRules,
  nextTier,
  parseClassifierV2Output,
  parseRoutingRulesYaml,
  type RoutingRules,
} from '../src/classifier-v2.js';

// A minimal in-memory rules document used by the unit tests so we don't have
// to read the on-disk YAML (and so we're independent of any taxonomy edits
// people make to config/routing-rules.yaml).
const TEST_RULES: RoutingRules = {
  version: 2,
  default_confidence_threshold: 0.6,
  escalation_threshold: 0.5,
  cascade_thresholds: {
    'local-7b': 0.6,
    'local-14b': 0.55,
    'local-32b': 0.5,
    'claude': 0.0,
    'stolution-batch': 0.5,
  },
  tier_order: ['local-7b', 'local-14b', 'local-32b', 'claude'],
  intents: [
    { name: 'classify', default_tier: 'local-7b', min_confidence: 0.6, keywords: ['classify', 'categorize'] },
    { name: 'summarize', default_tier: 'local-7b', min_confidence: 0.6, keywords: ['summarize', 'tldr'] },
    { name: 'medium-code', default_tier: 'local-14b', min_confidence: 0.55, keywords: ['implement function'] },
    { name: 'hard-code', default_tier: 'local-32b', min_confidence: 0.5, keywords: ['refactor multi-file'] },
    { name: 'new-design', default_tier: 'claude', min_confidence: 0.0, keywords: ['propose design'] },
    { name: 'embedding-generate', default_tier: 'stolution-batch', min_confidence: 0.5, keywords: ['vectorize'] },
    { name: 'unknown', default_tier: 'claude', min_confidence: 0.0, keywords: [] },
  ],
};

describe('classifier-v2', () => {
  describe('parseRoutingRulesYaml', () => {
    it('parses the schema with intents, thresholds, and cascade ladder', () => {
      const yaml = `
version: 2
default_confidence_threshold: 0.6
escalation_threshold: 0.5
cascade_thresholds:
  local-7b: 0.6
  claude: 0.0
tier_order:
  - local-7b
  - local-14b
  - claude
intents:
  - name: classify
    default_tier: local-7b
    min_confidence: 0.65
    keywords:
      - classify
      - tag
  - name: summarize
    default_tier: local-7b
    min_confidence: 0.6
    keywords: [summarize, tldr]
`;
      const rules = parseRoutingRulesYaml(yaml);
      expect(rules.version).toBe(2);
      expect(rules.default_confidence_threshold).toBe(0.6);
      expect(rules.escalation_threshold).toBe(0.5);
      expect(rules.cascade_thresholds['local-7b']).toBe(0.6);
      expect(rules.cascade_thresholds['claude']).toBe(0.0);
      expect(rules.tier_order).toEqual(['local-7b', 'local-14b', 'claude']);
      expect(rules.intents).toHaveLength(2);
      expect(rules.intents[0]).toEqual({
        name: 'classify',
        default_tier: 'local-7b',
        min_confidence: 0.65,
        keywords: ['classify', 'tag'],
      });
      expect(rules.intents[1]?.keywords).toEqual(['summarize', 'tldr']);
    });

    it('ignores comments and blank lines', () => {
      const yaml = `
# top-of-file comment
version: 2  # trailing comment
default_confidence_threshold: 0.6
escalation_threshold: 0.5

# section break

cascade_thresholds:
  local-7b: 0.6
tier_order: [local-7b]
intents:
  - name: classify
    default_tier: local-7b
    min_confidence: 0.6
    keywords: []
`;
      const rules = parseRoutingRulesYaml(yaml);
      expect(rules.version).toBe(2);
      expect(rules.intents).toHaveLength(1);
      expect(rules.intents[0]?.keywords).toEqual([]);
    });

    it('drops intents with unknown names or tiers', () => {
      const yaml = `
version: 2
default_confidence_threshold: 0.6
escalation_threshold: 0.5
cascade_thresholds:
  local-7b: 0.6
tier_order: [local-7b]
intents:
  - name: classify
    default_tier: local-7b
    min_confidence: 0.6
    keywords: []
  - name: not-a-real-intent
    default_tier: local-7b
    min_confidence: 0.6
    keywords: []
  - name: summarize
    default_tier: not-a-real-tier
    min_confidence: 0.6
    keywords: []
`;
      const rules = parseRoutingRulesYaml(yaml);
      expect(rules.intents.map(r => r.name)).toEqual(['classify']);
    });
  });

  describe('loadRoutingRules', () => {
    beforeEach(() => __resetRulesCache());

    it('loads the on-disk routing-rules.yaml', () => {
      const rules = loadRoutingRules();
      expect(rules.version).toBe(2);
      expect(rules.intents.length).toBeGreaterThan(5);
      const summarize = rules.intents.find(r => r.name === 'summarize');
      expect(summarize?.default_tier).toBe('local-7b');
      expect(rules.tier_order[0]).toBe('local-7b');
    });

    it('caches the parsed rules between calls', () => {
      const a = loadRoutingRules();
      const b = loadRoutingRules();
      expect(a).toBe(b);
    });

    // A.9.7 — the taxonomy expansion must show up in the loaded rules,
    // with at least one keyword each so the prepass can fire.
    it('A.9.7 — contains architecture-review and research-summary intents', () => {
      const rules = loadRoutingRules();
      const ar = rules.intents.find(r => r.name === 'architecture-review');
      const rs = rules.intents.find(r => r.name === 'research-summary');
      expect(ar).toBeDefined();
      expect(rs).toBeDefined();
      expect((ar?.keywords.length ?? 0) >= 5).toBe(true);
      expect((rs?.keywords.length ?? 0) >= 5).toBe(true);
      expect(ar?.default_tier).toBe('local-32b');
      expect(rs?.default_tier).toBe('local-14b');
    });

    it('A.9.7 — prose-rewrite + memory-search have expanded keyword coverage', () => {
      const rules = loadRoutingRules();
      const pr = rules.intents.find(r => r.name === 'prose-rewrite');
      const ms = rules.intents.find(r => r.name === 'memory-search');
      // Floor was 6 before A.9.7; expansion adds ≥4 each.
      expect((pr?.keywords.length ?? 0) >= 10).toBe(true);
      expect((ms?.keywords.length ?? 0) >= 12).toBe(true);
      // Specific keywords that didn't exist before A.9.7.
      expect(pr?.keywords).toContain('tighten this paragraph');
      expect(ms?.keywords).toContain('what did we decide about');
    });
  });

  describe('nextTier', () => {
    it('returns the next tier on the ladder', () => {
      expect(nextTier('local-7b', TEST_RULES.tier_order)).toBe('local-14b');
      expect(nextTier('local-14b', TEST_RULES.tier_order)).toBe('local-32b');
      expect(nextTier('local-32b', TEST_RULES.tier_order)).toBe('claude');
    });

    it('returns null at the top of the ladder', () => {
      expect(nextTier('claude', TEST_RULES.tier_order)).toBeNull();
    });

    it('returns null for tiers not on the ladder', () => {
      expect(nextTier('stolution-batch', TEST_RULES.tier_order)).toBeNull();
    });
  });

  describe('keywordPrepass', () => {
    it('matches when exactly one intent has a hit', () => {
      const result = keywordPrepass('please summarize the latest meeting notes', TEST_RULES);
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('summarize');
      expect(result!.source).toBe('keyword-prepass');
      expect(result!.confidence).toBeCloseTo(0.92);
      expect(result!.recommended_tier).toBe('local-7b');
      expect(result!.next_tier).toBe('local-14b');
      expect(result!.needs_cascade).toBe(false);
      expect(result!.needs_escalation).toBe(false);
    });

    it('returns null when no intent keywords match', () => {
      const result = keywordPrepass('mumble mumble nothing relevant here', TEST_RULES);
      expect(result).toBeNull();
    });

    it('returns null when multiple intents match (ambiguous)', () => {
      const result = keywordPrepass('classify and summarize this corpus', TEST_RULES);
      expect(result).toBeNull();
    });

    it('is case-insensitive', () => {
      const result = keywordPrepass('SUMMARIZE this', TEST_RULES);
      expect(result?.intent).toBe('summarize');
    });
  });

  describe('parseClassifierV2Output', () => {
    it('parses a well-formed LLM response and applies cascade rules', () => {
      const raw = JSON.stringify({
        intent: 'medium-code',
        confidence: 0.7,
        needs_escalation: false,
        recommended_tier: 'local-14b',
        reasoning: 'standard CRUD endpoint',
      });
      const r = parseClassifierV2Output(raw, TEST_RULES);
      expect(r.intent).toBe('medium-code');
      expect(r.confidence).toBe(0.7);
      expect(r.recommended_tier).toBe('local-14b');
      expect(r.next_tier).toBe('local-32b');
      expect(r.needs_cascade).toBe(false);
      expect(r.needs_escalation).toBe(false);
      expect(r.source).toBe('llm');
      expect(r.rules_version).toBe(2);
    });

    it('flags needs_cascade when confidence is below the tier floor', () => {
      const raw = JSON.stringify({
        intent: 'medium-code',
        confidence: 0.45,
        needs_escalation: false,
        recommended_tier: 'local-14b',
        reasoning: 'ambiguous spec',
      });
      const r = parseClassifierV2Output(raw, TEST_RULES);
      expect(r.needs_cascade).toBe(true);
      // below escalation_threshold (0.5) -> escalation forced on
      expect(r.needs_escalation).toBe(true);
    });

    it('prefers the rules taxonomy tier over the model-supplied tier', () => {
      // Model claims claude, but our rules say medium-code -> local-14b.
      const raw = JSON.stringify({
        intent: 'medium-code',
        confidence: 0.8,
        needs_escalation: false,
        recommended_tier: 'claude',
        reasoning: 'whatever',
      });
      const r = parseClassifierV2Output(raw, TEST_RULES);
      expect(r.recommended_tier).toBe('local-14b');
    });

    it('returns abstain on malformed JSON', () => {
      const r = parseClassifierV2Output('not-json{', TEST_RULES);
      expect(r.intent).toBe('unknown');
      expect(r.confidence).toBe(0);
      expect(r.recommended_tier).toBe('claude');
      expect(r.needs_escalation).toBe(true);
      expect(r.source).toBe('abstain');
    });

    it('returns abstain when the parsed body is not an object', () => {
      const r = parseClassifierV2Output('"a string"', TEST_RULES);
      expect(r.source).toBe('abstain');
    });

    it('coerces unknown intents and tiers to safe defaults', () => {
      const raw = JSON.stringify({
        intent: 'made-up-intent',
        confidence: 0.95,
        recommended_tier: 'made-up-tier',
        reasoning: '',
      });
      const r = parseClassifierV2Output(raw, TEST_RULES);
      expect(r.intent).toBe('unknown');
      expect(r.recommended_tier).toBe('claude'); // 'unknown' rule's default_tier
    });

    it('clamps invalid confidence to 0', () => {
      const raw = JSON.stringify({
        intent: 'classify',
        confidence: 'high',
        recommended_tier: 'local-7b',
        reasoning: '',
      });
      const r = parseClassifierV2Output(raw, TEST_RULES);
      expect(r.confidence).toBe(0);
      // 0 < escalation_threshold so this is escalation-worthy
      expect(r.needs_escalation).toBe(true);
    });
  });

  describe('classifyV2', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('uses the keyword prepass when one intent matches uniquely', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      const r = await classifyV2('please vectorize this batch of docs', { rules: TEST_RULES });
      expect(r.intent).toBe('embedding-generate');
      expect(r.source).toBe('keyword-prepass');
      expect(r.recommended_tier).toBe('stolution-batch');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('calls the LLM when the prepass is ambiguous', async () => {
      const ollamaBody = {
        message: {
          content: JSON.stringify({
            intent: 'classify',
            confidence: 0.8,
            needs_escalation: false,
            recommended_tier: 'local-7b',
            reasoning: 'multi-keyword spec',
          }),
        },
      };
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ollamaBody,
      } as unknown as Response);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const r = await classifyV2('classify and summarize this corpus', { rules: TEST_RULES });
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(r.intent).toBe('classify');
      expect(r.source).toBe('llm');
    });

    it('skipKeywordPrepass forces the LLM call even on a single-keyword spec', async () => {
      const ollamaBody = {
        message: {
          content: JSON.stringify({
            intent: 'summarize',
            confidence: 0.9,
            needs_escalation: false,
            recommended_tier: 'local-7b',
            reasoning: 'forced',
          }),
        },
      };
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ollamaBody,
      } as unknown as Response);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const r = await classifyV2('please summarize the doc', {
        rules: TEST_RULES,
        skipKeywordPrepass: true,
      });
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(r.source).toBe('llm');
    });

    it('returns abstain when Ollama returns non-2xx', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false, status: 503,
      } as unknown as Response) as unknown as typeof fetch;

      const r = await classifyV2('classify and summarize the corpus', { rules: TEST_RULES });
      expect(r.source).toBe('abstain');
      expect(r.recommended_tier).toBe('claude');
      expect(r.needs_escalation).toBe(true);
    });

    it('returns abstain when fetch throws (e.g. timeout)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
      const r = await classifyV2('classify and summarize', { rules: TEST_RULES });
      expect(r.source).toBe('abstain');
      expect(r.reasoning).toContain('boom');
    });
  });
});
