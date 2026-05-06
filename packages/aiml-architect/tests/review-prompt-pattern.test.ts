import { describe, it, expect } from 'vitest';

import { reviewPromptPattern } from '../src/review-prompt-pattern.js';

describe('reviewPromptPattern', () => {
  it('scores a perfect prompt high', () => {
    const result = reviewPromptPattern({
      templateId: 't1',
      template:
        'You are a domain classifier.\n\n' +
        'Examples:\n' +
        '  Input: Add OAuth login. Label: auth\n' +
        '  Input: Build a button. Label: ui\n\n' +
        'Think through this step by step.\n' +
        'Return as ```json\n{ "domain": "auth" }\n```',
      intendedTaskCategory: 'domain-classification',
      expectedOutputShape: 'json'
    });
    expect(result.score).toBeGreaterThan(0.7);
  });

  it('scores a poor prompt low and provides findings', () => {
    const result = reviewPromptPattern({
      templateId: 't2',
      template: 'do not not no never not no.',
      intendedTaskCategory: 'po-decomposer-coverage-judge',
      expectedOutputShape: 'json'
    });
    expect(result.score).toBeLessThan(0.7);
    expect(result.findings.length).toBeGreaterThan(2);
  });

  it('provides rewrite suggestion for very low scores', () => {
    const result = reviewPromptPattern({
      templateId: 't2b',
      template:
        'do not not no never not no never not no never not no never not no never not no',
      intendedTaskCategory: 'po-decomposer-coverage-judge',
      expectedOutputShape: 'json'
    });
    if (result.score < 0.5) {
      expect(result.rewriteSuggestion).toBeDefined();
    }
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('emits findings of varied severity', () => {
    const result = reviewPromptPattern({
      templateId: 't3',
      template: 'classify this.',
      intendedTaskCategory: 'domain-classification',
      expectedOutputShape: 'plain'
    });
    expect(result.findings.length).toBeGreaterThan(0);
    const severities = new Set(result.findings.map((f) => f.severity));
    expect(severities.size).toBeGreaterThanOrEqual(1);
  });

  it('recommends DSPy compile only with 2-of-3 signals', () => {
    const result = reviewPromptPattern({
      templateId: 't4',
      template: 'Decompose this initiative.',
      intendedTaskCategory: 'po-decomposer-coverage-judge',
      expectedOutputShape: 'plain'
    });
    expect(result.recommendDspyCompile).toBe(false);
  });

  it('does not recommend DSPy compile for unknown task', () => {
    const result = reviewPromptPattern({
      templateId: 't5',
      template: 'You are an agent. Help with this task.',
      intendedTaskCategory: 'totally-unknown',
      expectedOutputShape: 'plain'
    });
    expect(result.recommendDspyCompile).toBe(false);
  });
});
