import { describe, expect, it } from 'vitest';
import { mergeFindings } from '../src/merger.js';
import type { CraftsmanshipFinding } from '../src/types.js';

const det = (over: Partial<CraftsmanshipFinding> = {}): CraftsmanshipFinding => ({
  id: 'rev-' + Math.random().toString(16).slice(2),
  dimension: 'naming-convention',
  severity: 'nit',
  file: 'a.ts',
  line: 1,
  suggestionTitle: 't',
  description: 'd',
  source: 'deterministic',
  detectorId: 'det-x',
  excerpt: 'e',
  ...over
});

describe('mergeFindings', () => {
  it('dedups by id', () => {
    const a = det({ id: 'rev-a' });
    const b = det({ id: 'rev-a' });
    const merged = mergeFindings({
      deterministic: [a, b],
      llmReasoned: { findings: [], ok: true },
      severityFloor: 'nit',
      maxFindings: 30,
      llmEnabled: false,
      chunksReviewed: 1,
      durationMs: 0
    });
    expect(merged.findings).toHaveLength(1);
  });

  it('drops findings below severity floor', () => {
    const a = det({ id: 'rev-a', severity: 'nit' });
    const b = det({ id: 'rev-b', severity: 'consider' });
    const merged = mergeFindings({
      deterministic: [a, b],
      llmReasoned: { findings: [], ok: true },
      severityFloor: 'consider',
      maxFindings: 30,
      llmEnabled: false,
      chunksReviewed: 1,
      durationMs: 0
    });
    expect(merged.findings).toHaveLength(1);
    expect(merged.findings[0]?.severity).toBe('consider');
  });

  it('caps to maxFindings', () => {
    const findings = Array.from({ length: 10 }, (_, i) => det({ id: `rev-${i}` }));
    const merged = mergeFindings({
      deterministic: findings,
      llmReasoned: { findings: [], ok: true },
      severityFloor: 'nit',
      maxFindings: 3,
      llmEnabled: false,
      chunksReviewed: 1,
      durationMs: 0
    });
    expect(merged.findings).toHaveLength(3);
  });

  it('drops Critic-denylisted LLM findings and counts redirects', () => {
    const merged = mergeFindings({
      deterministic: [],
      llmReasoned: {
        findings: [
          { dimension: 'security-regression' as never, severity: 'consider', file: 'a', line: 1, suggestionTitle: 't', description: 'd', excerpt: '' },
          { dimension: 'naming-convention', severity: 'nit', file: 'a', line: 2, suggestionTitle: 't2', description: 'd', excerpt: '' }
        ],
        ok: true
      },
      severityFloor: 'nit',
      maxFindings: 30,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 0
    });
    expect(merged.summary.redirectsToCritic).toBe(1);
    expect(merged.findings).toHaveLength(1);
    expect(merged.findings[0]?.dimension).toBe('naming-convention');
  });

  it('praise findings sort first', () => {
    const a = det({ id: 'a', severity: 'consider' });
    const p = det({ id: 'p', severity: 'praise' });
    const merged = mergeFindings({
      deterministic: [a, p],
      llmReasoned: { findings: [], ok: true },
      severityFloor: 'praise',
      maxFindings: 30,
      llmEnabled: false,
      chunksReviewed: 1,
      durationMs: 0
    });
    expect(merged.findings[0]?.severity).toBe('praise');
  });

  it('llmReasoningSucceeded reflects llm.ok when enabled', () => {
    const merged = mergeFindings({
      deterministic: [],
      llmReasoned: { findings: [], ok: false },
      severityFloor: 'nit',
      maxFindings: 30,
      llmEnabled: true,
      chunksReviewed: 0,
      durationMs: 0
    });
    expect(merged.summary.llmReasoningSucceeded).toBe(false);
  });
});
