import { describe, it, expect } from 'vitest';

import {
  PROMPT_PATTERN_RULES,
  scoreFromFindings
} from '../src/knowledge/prompt-patterns.js';

describe('PROMPT_PATTERN_RULES', () => {
  it('detects a missing role', () => {
    const rule = PROMPT_PATTERN_RULES.find((r) => r.pattern === 'role');
    expect(rule).toBeDefined();
    const findings = rule!.check({
      template: 'classify this domain.',
      intendedTaskCategory: 'domain-classification',
      expectedOutputShape: 'plain'
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('warn');
  });

  it('passes when a role is present', () => {
    const rule = PROMPT_PATTERN_RULES.find((r) => r.pattern === 'role');
    const findings = rule!.check({
      template: 'You are a domain classifier. Classify this.',
      intendedTaskCategory: 'domain-classification',
      expectedOutputShape: 'plain'
    });
    expect(findings).toHaveLength(0);
  });

  it('flags missing JSON shape when output expects json', () => {
    const rule = PROMPT_PATTERN_RULES.find((r) => r.pattern === 'json-shape');
    const findings = rule!.check({
      template: 'Return the answer.',
      intendedTaskCategory: 'domain-classification',
      expectedOutputShape: 'json'
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('error');
  });

  it('passes when a JSON example is included', () => {
    const rule = PROMPT_PATTERN_RULES.find((r) => r.pattern === 'json-shape');
    const findings = rule!.check({
      template: 'Return the answer as ```json\n{ "domain": "auth" }\n```',
      intendedTaskCategory: 'domain-classification',
      expectedOutputShape: 'json'
    });
    expect(findings).toHaveLength(0);
  });

  it('warns about missing few-shot for classification', () => {
    const rule = PROMPT_PATTERN_RULES.find((r) => r.pattern === 'few-shot');
    const findings = rule!.check({
      template: 'Classify the domain of this prompt.',
      intendedTaskCategory: 'domain-classification',
      expectedOutputShape: 'plain'
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('warn');
  });

  it('warns about missing CoT for reasoning task', () => {
    const rule = PROMPT_PATTERN_RULES.find((r) => r.pattern === 'cot');
    const findings = rule!.check({
      template: 'Decompose this initiative into epics.',
      intendedTaskCategory: 'hierarchy-decomposition',
      expectedOutputShape: 'plain'
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('warn');
  });

  it('flags excessive politeness as token waste', () => {
    const rule = PROMPT_PATTERN_RULES.find((r) => r.pattern === 'token-waste');
    const findings = rule!.check({
      template: 'please please please please please do the thing.',
      intendedTaskCategory: 'misc',
      expectedOutputShape: 'plain'
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('warn');
  });

  it('flags high negation density as ambiguity', () => {
    const rule = PROMPT_PATTERN_RULES.find((r) => r.pattern === 'ambiguity');
    const findings = rule!.check({
      template: 'do not not never not no not no not no',
      intendedTaskCategory: 'misc',
      expectedOutputShape: 'plain'
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('warn');
  });
});

describe('scoreFromFindings', () => {
  it('returns 1 when no findings', () => {
    expect(scoreFromFindings([])).toBe(1);
  });

  it('drops below 1 with a warn finding', () => {
    const score = scoreFromFindings([
      {
        pattern: 'role',
        severity: 'warn',
        detail: '...',
        recommendation: '...'
      }
    ]);
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThan(0.5);
  });

  it('drops more with an error finding', () => {
    const warnScore = scoreFromFindings([
      {
        pattern: 'json-shape',
        severity: 'warn',
        detail: '...',
        recommendation: '...'
      }
    ]);
    const errorScore = scoreFromFindings([
      {
        pattern: 'json-shape',
        severity: 'error',
        detail: '...',
        recommendation: '...'
      }
    ]);
    expect(errorScore).toBeLessThan(warnScore);
  });

  it('clamps to [0, 1]', () => {
    const findings = PROMPT_PATTERN_RULES.map((r) => ({
      pattern: r.pattern,
      severity: 'error' as const,
      detail: '...',
      recommendation: '...'
    }));
    const score = scoreFromFindings(findings);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
