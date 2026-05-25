import { describe, it, expect } from 'vitest';
import { runErrorLens } from '../src/lenses/error.js';
import { makeTestCase } from './fixtures.js';

describe('runErrorLens', () => {
  it('emits no findings on empty test-cases', () => {
    expect(
      runErrorLens({ testCases: [], composedArchitecture: {} }),
    ).toEqual([]);
  });

  it('fires the baseline finding when no error test exists', () => {
    const findings = runErrorLens({
      testCases: [
        makeTestCase({ category: 'happy' }),
        makeTestCase({ category: 'edge' }),
      ],
      composedArchitecture: {},
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.qualifier).toBe('baseline');
  });

  it('passes when at least one error test exists and no quality-tag floors fire', () => {
    expect(
      runErrorLens({
        testCases: [
          makeTestCase({ category: 'happy' }),
          makeTestCase({ category: 'error' }),
        ],
        composedArchitecture: {},
      }),
    ).toEqual([]);
  });

  it('fires the a11y floor when wcagLevel is set but no accessibility tests exist', () => {
    const findings = runErrorLens({
      testCases: [
        makeTestCase({ category: 'happy' }),
        makeTestCase({ category: 'error' }),
      ],
      composedArchitecture: { 'a11y.wcagLevel': 'AA' },
    });
    expect(findings.some((f) => f.qualifier === 'a11y')).toBe(true);
  });

  it('passes the a11y floor when an accessibility test exists', () => {
    const findings = runErrorLens({
      testCases: [
        makeTestCase({ category: 'error' }),
        makeTestCase({ category: 'accessibility' }),
      ],
      composedArchitecture: { 'a11y.wcagLevel': 'AA' },
    });
    expect(findings.some((f) => f.qualifier === 'a11y')).toBe(false);
  });

  it('fires the security floor when dataClassification is PII', () => {
    const findings = runErrorLens({
      testCases: [
        makeTestCase({ category: 'happy' }),
        makeTestCase({ category: 'error' }),
      ],
      composedArchitecture: { 'security.dataClassification': 'PII' },
    });
    expect(findings.some((f) => f.qualifier === 'security')).toBe(true);
  });

  it('fires the security floor when dataClassification is confidential', () => {
    const findings = runErrorLens({
      testCases: [makeTestCase({ category: 'error' })],
      composedArchitecture: { 'security.dataClassification': 'confidential' },
    });
    expect(findings.some((f) => f.qualifier === 'security')).toBe(true);
  });

  it('does NOT fire the security floor when data classification is public', () => {
    const findings = runErrorLens({
      testCases: [makeTestCase({ category: 'error' })],
      composedArchitecture: { 'security.dataClassification': 'public' },
    });
    expect(findings.some((f) => f.qualifier === 'security')).toBe(false);
  });

  it('passes the security floor when a security test exists', () => {
    expect(
      runErrorLens({
        testCases: [
          makeTestCase({ category: 'error' }),
          makeTestCase({ category: 'security' }),
        ],
        composedArchitecture: { 'security.dataClassification': 'PII' },
      }),
    ).toEqual([]);
  });
});
