import { describe, it, expect } from 'vitest';

import {
  classifyVerdict,
  countByStatusPure,
} from '../src/outcome-steward-adapter.js';
import type { AttestationCell } from '@caia/outcome-steward';

const cell = (overrides: Partial<AttestationCell> = {}): AttestationCell => ({
  packageName: '@caia/example', solutionId: 'S-1', sliMetric: 'm1',
  status: 'green', latestValue: 1, threshold: 0, direction: 'gt',
  trend: 'up', trendSlopePerHour: 1, result: null, ...overrides,
});

describe('countByStatusPure', () => {
  it('tallies by status', () => {
    const out = countByStatusPure([
      cell({ status: 'green' }),
      cell({ status: 'green' }),
      cell({ status: 'yellow' }),
      cell({ status: 'red' }),
      cell({ status: 'no-metric-declared' }),
      cell({ status: 'no-metric-store' }),
      cell({ status: 'unknown' }),
    ]);
    expect(out).toEqual({ green: 2, yellow: 1, red: 1, noMetricDeclared: 1, noMetricStore: 1, unknown: 1 });
  });
  it('handles empty list', () => {
    expect(countByStatusPure([])).toEqual({
      green: 0, yellow: 0, red: 0, noMetricDeclared: 0, noMetricStore: 0, unknown: 0,
    });
  });
});

describe('classifyVerdict', () => {
  const zero = { green: 0, yellow: 0, red: 0, noMetricDeclared: 0, noMetricStore: 0, unknown: 0 };

  it('no-metric-store when backend absent', () => {
    expect(classifyVerdict(zero, 'absent')).toBe('no-metric-store');
  });
  it('degraded when backend degraded', () => {
    expect(classifyVerdict(zero, 'degraded')).toBe('degraded');
  });
  it('red when any red cells', () => {
    expect(classifyVerdict({ ...zero, red: 1 }, 'present')).toBe('red');
  });
  it('mixed on yellow only', () => {
    expect(classifyVerdict({ ...zero, yellow: 1, green: 1 }, 'present')).toBe('mixed');
  });
  it('mixed on unknown only', () => {
    expect(classifyVerdict({ ...zero, unknown: 1, green: 1 }, 'present')).toBe('mixed');
  });
  it('all-green on a fully-green tally', () => {
    expect(classifyVerdict({ ...zero, green: 3 }, 'present')).toBe('all-green');
  });
  it('no-metric-declared when zero cells overall', () => {
    expect(classifyVerdict(zero, 'present')).toBe('no-metric-declared');
  });
  it('no-metric-declared dominates over zero-green declared rows', () => {
    expect(classifyVerdict({ ...zero, noMetricDeclared: 2 }, 'present')).toBe('no-metric-declared');
  });
});
