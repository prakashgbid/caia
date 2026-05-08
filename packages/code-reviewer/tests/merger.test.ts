import { describe, it, expect } from 'vitest';
import { mergeFindings } from '../src/merger.js';
import type { CodeReviewFinding, LlmReviewOutput } from '../src/types.js';

const baseLlmOutput = (
  findings: ReadonlyArray<Omit<CodeReviewFinding, 'id' | 'source' | 'detectorId'>>
): LlmReviewOutput => ({ findings, ok: true });

describe('mergeFindings — verdict synthesis', () => {
  it('returns approve when no findings', () => {
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: baseLlmOutput([]),
      severityFloor: 'low',
      blockingSeverityThreshold: 'medium',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 0,
      durationMs: 100
    });
    expect(result.verdict).toBe('approve');
    expect(result.findings).toHaveLength(0);
    expect(result.blockingFindings).toHaveLength(0);
  });

  it('returns approve when only low findings (below blocking threshold)', () => {
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: baseLlmOutput([
        { dimension: 'style', severity: 'low', file: 'a.ts', line: 1, issueTitle: 'spacing', description: 'd', excerpt: '' }
      ]),
      severityFloor: 'low',
      blockingSeverityThreshold: 'medium',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 100
    });
    expect(result.verdict).toBe('approve');
    expect(result.findings).toHaveLength(1);
    expect(result.blockingFindings).toHaveLength(0);
  });

  it('returns request-changes when at least one finding meets blocking threshold', () => {
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: baseLlmOutput([
        { dimension: 'correctness', severity: 'high', file: 'a.ts', line: 1, issueTitle: 'bug', description: 'd', excerpt: '' },
        { dimension: 'style', severity: 'low', file: 'a.ts', line: 2, issueTitle: 'sp', description: 'd', excerpt: '' }
      ]),
      severityFloor: 'low',
      blockingSeverityThreshold: 'medium',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 100
    });
    expect(result.verdict).toBe('request-changes');
    expect(result.blockingFindings).toHaveLength(1);
    expect(result.blockingFindings[0].severity).toBe('high');
  });

  it('honours custom blocking threshold', () => {
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: baseLlmOutput([
        { dimension: 'correctness', severity: 'medium', file: 'a.ts', line: 1, issueTitle: 't', description: 'd', excerpt: '' }
      ]),
      severityFloor: 'low',
      blockingSeverityThreshold: 'high',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 100
    });
    expect(result.verdict).toBe('approve');
    expect(result.findings).toHaveLength(1);
    expect(result.blockingFindings).toHaveLength(0);
  });
});

describe('mergeFindings — denylist enforcement', () => {
  it('drops findings on Critic denylist and counts them', () => {
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: baseLlmOutput([
        // Pretend an LLM emitted a Critic-domain finding even after sanitiser
        { dimension: 'security-regression' as never, severity: 'high', file: 'a.ts', line: 1, issueTitle: 't', description: 'd', excerpt: '' },
        { dimension: 'correctness', severity: 'high', file: 'a.ts', line: 2, issueTitle: 't', description: 'd', excerpt: '' }
      ]),
      severityFloor: 'low',
      blockingSeverityThreshold: 'medium',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 100
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].dimension).toBe('correctness');
    expect(result.summary.redirectsToCritic).toBe(1);
  });

  it('drops findings on advisory Reviewer denylist and counts them', () => {
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: baseLlmOutput([
        { dimension: 'idiom-adherence' as never, severity: 'medium', file: 'a.ts', line: 1, issueTitle: 't', description: 'd', excerpt: '' },
        { dimension: 'correctness', severity: 'high', file: 'a.ts', line: 2, issueTitle: 't', description: 'd', excerpt: '' }
      ]),
      severityFloor: 'low',
      blockingSeverityThreshold: 'medium',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 100
    });
    expect(result.findings).toHaveLength(1);
    expect(result.summary.redirectsToReviewer).toBe(1);
  });
});

describe('mergeFindings — severity floor + sort + cap', () => {
  it('drops findings below severity floor', () => {
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: baseLlmOutput([
        { dimension: 'style', severity: 'low', file: 'a.ts', line: 1, issueTitle: 't', description: 'd', excerpt: '' },
        { dimension: 'correctness', severity: 'high', file: 'a.ts', line: 2, issueTitle: 't', description: 'd', excerpt: '' }
      ]),
      severityFloor: 'medium',
      blockingSeverityThreshold: 'medium',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 100
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('high');
  });

  it('sorts severity descending', () => {
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: baseLlmOutput([
        { dimension: 'style', severity: 'low', file: 'a.ts', line: 1, issueTitle: 't1', description: 'd', excerpt: '' },
        { dimension: 'correctness', severity: 'critical', file: 'a.ts', line: 2, issueTitle: 't2', description: 'd', excerpt: '' },
        { dimension: 'naming', severity: 'medium', file: 'a.ts', line: 3, issueTitle: 't3', description: 'd', excerpt: '' }
      ]),
      severityFloor: 'low',
      blockingSeverityThreshold: 'medium',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 100
    });
    expect(result.findings[0].severity).toBe('critical');
    expect(result.findings[result.findings.length - 1].severity).toBe('low');
  });

  it('caps at maxFindings', () => {
    const findings = Array.from({ length: 100 }, (_, i) => ({
      dimension: 'correctness' as const,
      severity: 'high' as const,
      file: `a${i}.ts`,
      line: 1,
      issueTitle: `t${i}`,
      description: 'd',
      excerpt: ''
    }));
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: baseLlmOutput(findings),
      severityFloor: 'low',
      blockingSeverityThreshold: 'medium',
      maxFindings: 5,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 100
    });
    expect(result.findings).toHaveLength(5);
  });

  it('dedups by id', () => {
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: baseLlmOutput([
        { dimension: 'correctness', severity: 'high', file: 'a.ts', line: 1, issueTitle: 'same', description: 'd', excerpt: '' },
        { dimension: 'correctness', severity: 'high', file: 'a.ts', line: 1, issueTitle: 'same', description: 'd2', excerpt: '' }
      ]),
      severityFloor: 'low',
      blockingSeverityThreshold: 'medium',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 100
    });
    expect(result.findings).toHaveLength(1);
  });
});

describe('mergeFindings — summary', () => {
  it('counts by severity and dimension', () => {
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: baseLlmOutput([
        { dimension: 'correctness', severity: 'high', file: 'a.ts', line: 1, issueTitle: 't1', description: 'd', excerpt: '' },
        { dimension: 'correctness', severity: 'medium', file: 'a.ts', line: 2, issueTitle: 't2', description: 'd', excerpt: '' },
        { dimension: 'naming', severity: 'low', file: 'a.ts', line: 3, issueTitle: 't3', description: 'd', excerpt: '' }
      ]),
      severityFloor: 'low',
      blockingSeverityThreshold: 'medium',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 2,
      durationMs: 500
    });
    expect(result.summary.countBySeverity.high).toBe(1);
    expect(result.summary.countBySeverity.medium).toBe(1);
    expect(result.summary.countBySeverity.low).toBe(1);
    expect(result.summary.countByDimension.correctness).toBe(2);
    expect(result.summary.countByDimension.naming).toBe(1);
    expect(result.summary.chunksReviewed).toBe(2);
    expect(result.summary.durationMs).toBe(500);
  });

  it('marks llmReasoningSucceeded false when LLM enabled but ok:false', () => {
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: { findings: [], ok: false, diagnostic: 'timeout' },
      severityFloor: 'low',
      blockingSeverityThreshold: 'medium',
      maxFindings: 50,
      llmEnabled: true,
      chunksReviewed: 1,
      durationMs: 100
    });
    expect(result.summary.llmReasoningSucceeded).toBe(false);
  });

  it('marks llmReasoningSucceeded true when LLM disabled', () => {
    const result = mergeFindings({
      deterministic: [],
      llmReasoned: baseLlmOutput([]),
      severityFloor: 'low',
      blockingSeverityThreshold: 'medium',
      maxFindings: 50,
      llmEnabled: false,
      chunksReviewed: 0,
      durationMs: 1
    });
    expect(result.summary.llmReasoningSucceeded).toBe(true);
  });
});
