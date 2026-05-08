import { describe, it, expect } from 'vitest';

import { mergeFindings } from '../src/merger.js';
import { findingId } from '../src/detectors/shared.js';
import type { AdversarialFinding } from '../src/types.js';

function det(overrides: Partial<AdversarialFinding> = {}): AdversarialFinding {
  return {
    id: 'a',
    category: 'premature-completion',
    severity: 'high',
    file: 'f.ts',
    line: 1,
    attackVector: 'v',
    description: 'd',
    reproductionSteps: [],
    source: 'deterministic',
    detectorId: 'det',
    excerpt: '',
    ...overrides
  };
}

describe('mergeFindings', () => {
  it('dedups by id (deterministic wins)', () => {
    const sharedId = findingId({ category: 'premature-completion', file: 'f.ts', line: 1, attackVector: 'v' });
    const r = mergeFindings({
      deterministic: [det({ id: sharedId, source: 'deterministic' })],
      llmReasoned: { ok: true, findings: [{ category: 'premature-completion', severity: 'high', file: 'f.ts', line: 1, attackVector: 'v', description: 'llm version', reproductionSteps: [], excerpt: '' }] },
      severityFloor: 'low',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 10
    });
    // both findings share (category|file|line|attackVector) → same id-hash → only one keeps.
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.source).toBe('deterministic');
    expect(r.findings[0]?.description).toBe('d');
  });

  it('floors below severityFloor', () => {
    const r = mergeFindings({
      deterministic: [
        det({ id: 'low', severity: 'low' }),
        det({ id: 'med', severity: 'medium' }),
        det({ id: 'hi', severity: 'high' })
      ],
      llmReasoned: { ok: true, findings: [] },
      severityFloor: 'medium',
      maxFindings: 50,
      llmEnabled: false,
      chunksReviewed: 1,
      durationMs: 1
    });
    expect(r.findings).toHaveLength(2);
    expect(r.findings.map(f => f.severity)).not.toContain('low');
  });

  it('marks high+ as blockingFindings', () => {
    const r = mergeFindings({
      deterministic: [
        det({ id: 'm', severity: 'medium' }),
        det({ id: 'h', severity: 'high' }),
        det({ id: 'c', severity: 'critical' })
      ],
      llmReasoned: { ok: true, findings: [] },
      severityFloor: 'low',
      maxFindings: 50,
      llmEnabled: false,
      chunksReviewed: 1,
      durationMs: 1
    });
    expect(r.blockingFindings).toHaveLength(2);
  });

  it('caps at maxFindings', () => {
    const dets = Array.from({ length: 100 }, (_, i) => det({ id: `d${i}`, line: i }));
    const r = mergeFindings({
      deterministic: dets,
      llmReasoned: { ok: true, findings: [] },
      severityFloor: 'low',
      maxFindings: 10,
      llmEnabled: false,
      chunksReviewed: 1,
      durationMs: 1
    });
    expect(r.findings).toHaveLength(10);
  });

  it('summary tracks llmReasoningSucceeded', () => {
    const r = mergeFindings({
      deterministic: [],
      llmReasoned: { ok: false, findings: [], diagnostic: 'rate limit' },
      severityFloor: 'low',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 1
    });
    expect(r.summary.llmReasoningSucceeded).toBe(false);
    expect(r.summary.llmEnabled).toBe(true);
  });

  it('orders findings: severity desc, then category, then file, then line', () => {
    const r = mergeFindings({
      deterministic: [
        det({ id: 'a', severity: 'high', category: 'premature-completion', file: 'b.ts', line: 5 }),
        det({ id: 'b', severity: 'critical', category: 'security-regression', file: 'a.ts', line: 1 }),
        det({ id: 'c', severity: 'high', category: 'premature-completion', file: 'a.ts', line: 1 })
      ],
      llmReasoned: { ok: true, findings: [] },
      severityFloor: 'low',
      maxFindings: 50,
      llmEnabled: false,
      chunksReviewed: 1,
      durationMs: 1
    });
    expect(r.findings[0]?.severity).toBe('critical');
    expect(r.findings[1]?.file).toBe('a.ts');
  });
});
