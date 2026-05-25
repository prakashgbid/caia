import { describe, it, expect } from 'vitest';
import { runAcCoverageLens } from '../src/lenses/ac-coverage.js';
import { makeTestCase } from './fixtures.js';

describe('runAcCoverageLens', () => {
  it('returns no findings when every AC has a happy linked test', () => {
    const findings = runAcCoverageLens({
      testCases: [
        makeTestCase({ category: 'happy', linkedAcceptanceCriterionIndex: 0 }),
        makeTestCase({ category: 'happy', linkedAcceptanceCriterionIndex: 1 }),
      ],
      acceptanceCriteria: ['AC0', 'AC1'],
    });
    expect(findings).toEqual([]);
  });

  it('flags an AC with no linked test at all', () => {
    const findings = runAcCoverageLens({
      testCases: [
        makeTestCase({ category: 'happy', linkedAcceptanceCriterionIndex: 0 }),
      ],
      acceptanceCriteria: ['AC0', 'AC1'],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.acIndex).toBe(1);
    expect(findings[0]?.reason).toMatch(/no linked test case/);
  });

  it('flags an AC linked only by edge/error tests (missing happy)', () => {
    const findings = runAcCoverageLens({
      testCases: [
        makeTestCase({ category: 'error', linkedAcceptanceCriterionIndex: 0 }),
        makeTestCase({ category: 'edge', linkedAcceptanceCriterionIndex: 0 }),
      ],
      acceptanceCriteria: ['AC0'],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toMatch(/none with category='happy'/);
  });

  it('emits no findings on empty acceptance-criteria array', () => {
    const findings = runAcCoverageLens({
      testCases: [makeTestCase({ category: 'happy' })],
      acceptanceCriteria: [],
    });
    expect(findings).toEqual([]);
  });

  it('emits findings for every AC when test-cases is empty', () => {
    const findings = runAcCoverageLens({
      testCases: [],
      acceptanceCriteria: ['A', 'B', 'C'],
    });
    expect(findings).toHaveLength(3);
    expect(findings.map((f) => f.acIndex)).toEqual([0, 1, 2]);
  });

  it('honors a custom severity', () => {
    const findings = runAcCoverageLens({
      testCases: [],
      acceptanceCriteria: ['AC0'],
      severity: 'P0',
    });
    expect(findings[0]?.severity).toBe('P0');
  });

  it('records the AC text on the finding', () => {
    const findings = runAcCoverageLens({
      testCases: [],
      acceptanceCriteria: ['User can log in'],
    });
    expect(findings[0]?.acText).toBe('User can log in');
  });
});
