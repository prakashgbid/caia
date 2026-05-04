import { describe, it, expect } from 'vitest';
import { checkGraphDivergence } from '../src/index.js';

const NOW = 1750000000;
const DAY = 86400;

describe('checkGraphDivergence', () => {
  it('emits zero findings when merge-base is fresh (under threshold)', () => {
    const findings = checkGraphDivergence({
      mergeBaseTimestamp: NOW - 3 * DAY,
      nowTimestamp: NOW,
    });
    expect(findings).toEqual([]);
  });

  it('emits zero findings when a back-merge PR is already present', () => {
    const findings = checkGraphDivergence({
      mergeBaseTimestamp: NOW - 30 * DAY,
      nowTimestamp: NOW,
      backMergePrPresent: true,
    });
    expect(findings).toEqual([]);
  });

  it('emits a medium-severity finding on non-release PR over threshold', () => {
    const findings = checkGraphDivergence({
      mergeBaseTimestamp: NOW - 14 * DAY,
      nowTimestamp: NOW,
      prHeadRef: 'feat/something',
    });
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].context!.ageDays).toBeGreaterThan(7);
  });

  it('emits a block-severity finding on release/* PR over threshold', () => {
    const findings = checkGraphDivergence({
      mergeBaseTimestamp: NOW - 14 * DAY,
      nowTimestamp: NOW,
      prHeadRef: 'release/2026-05-04',
    });
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('block');
    expect(findings[0].context!.isReleasePr).toBe(true);
  });

  it('respects custom maxAgeDays', () => {
    // 5d old, threshold 3 → over.
    const findings = checkGraphDivergence({
      mergeBaseTimestamp: NOW - 5 * DAY,
      nowTimestamp: NOW,
      maxAgeDays: 3,
      prHeadRef: 'release/x',
    });
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('block');
  });

  it('remediation hint references back-merge recipe', () => {
    const findings = checkGraphDivergence({
      mergeBaseTimestamp: NOW - 14 * DAY,
      nowTimestamp: NOW,
      prHeadRef: 'release/x',
    });
    expect(findings[0].remediation).toContain('back-merge');
  });
});
