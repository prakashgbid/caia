import { describe, expect, it } from 'vitest';
import {
  buildAttestationMatrix,
  classifyCell,
  countByStatus,
  getCell,
} from '../src/matrix.js';
import type { CrossCheckResult, ExpectedSli } from '../src/types.js';

function sli(overrides: Partial<ExpectedSli> = {}): ExpectedSli {
  return {
    metric: 'pkg:m',
    query: 'q',
    threshold: 1.0,
    direction: 'gt',
    trendDirection: 'any',
    freshnessHours: 24,
    optional: false,
    ...overrides,
  };
}

function result(overrides: Partial<CrossCheckResult> = {}): CrossCheckResult {
  return {
    packageName: '@caia/x',
    solutionId: 'sol-x',
    sli: sli(),
    latestValue: 2.0,
    trendSlopePerHour: 0,
    trend: 'flat',
    thresholdSatisfied: true,
    trendSatisfied: true,
    metricPresent: true,
    sampleCount: 5,
    mostRecentAtIso: '2026-05-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('classifyCell', () => {
  it('returns green when threshold + trend both satisfied', () => {
    const c = classifyCell(result(), 'present');
    expect(c.status).toBe('green');
  });

  it('returns red when metric is missing AND not optional', () => {
    const c = classifyCell(
      result({ metricPresent: false, latestValue: null, thresholdSatisfied: false }),
      'present',
    );
    expect(c.status).toBe('red');
  });

  it('returns yellow when metric is missing BUT optional', () => {
    const c = classifyCell(
      result({
        sli: sli({ optional: true }),
        metricPresent: false,
        latestValue: null,
        thresholdSatisfied: false,
      }),
      'present',
    );
    expect(c.status).toBe('yellow');
  });

  it('returns red when threshold fails AND not optional', () => {
    const c = classifyCell(result({ thresholdSatisfied: false }), 'present');
    expect(c.status).toBe('red');
  });

  it('returns yellow when threshold ok but trend violated', () => {
    const c = classifyCell(
      result({
        sli: sli({ trendDirection: 'up' }),
        trend: 'down',
        trendSatisfied: false,
      }),
      'present',
    );
    expect(c.status).toBe('yellow');
  });

  it('returns no-metric-declared for the synthetic row regardless of backend', () => {
    const synthetic = result({
      sli: sli({ metric: '__no_metric_declared__', query: '__no_metric_declared__' }),
      metricPresent: false,
      latestValue: null,
      thresholdSatisfied: false,
    });
    expect(classifyCell(synthetic, 'absent').status).toBe('no-metric-declared');
    expect(classifyCell(synthetic, 'present').status).toBe('no-metric-declared');
    expect(classifyCell(synthetic, 'degraded').status).toBe('no-metric-declared');
  });

  it('returns no-metric-store when backend is absent', () => {
    const c = classifyCell(result({ metricPresent: false }), 'absent');
    expect(c.status).toBe('no-metric-store');
  });

  it('returns unknown when backend is degraded and base would be red', () => {
    const c = classifyCell(
      result({ thresholdSatisfied: false }),
      'degraded',
    );
    expect(c.status).toBe('unknown');
  });

  it('returns unknown when backend is degraded and base would be green', () => {
    const c = classifyCell(result(), 'degraded');
    expect(c.status).toBe('unknown');
  });
});

describe('buildAttestationMatrix', () => {
  it('builds a map keyed by package::solution::sli', () => {
    const m = buildAttestationMatrix(
      [result({ sli: sli({ metric: 'm1' }) }), result({ sli: sli({ metric: 'm2' }) })],
      { backend: 'present' },
    );
    expect(m.cells.size).toBe(2);
    expect(m.packages).toEqual(['@caia/x']);
    expect(m.solutions).toEqual(['sol-x']);
  });

  it('countByStatus tallies correctly', () => {
    const m = buildAttestationMatrix(
      [
        result({ sli: sli({ metric: 'm1' }) }),
        result({ sli: sli({ metric: 'm2' }), thresholdSatisfied: false }),
      ],
      { backend: 'present' },
    );
    const c = countByStatus(m);
    expect(c.green).toBe(1);
    expect(c.red).toBe(1);
  });

  it('getCell finds the cell or returns undefined', () => {
    const m = buildAttestationMatrix([result()], { backend: 'present' });
    const cell = getCell(m, '@caia/x', 'sol-x', 'pkg:m');
    expect(cell).toBeDefined();
    expect(cell!.status).toBe('green');
    expect(getCell(m, 'missing', 'x', 'y')).toBeUndefined();
  });

  it('produces all no-metric-store cells when backend absent', () => {
    const m = buildAttestationMatrix(
      [result({ thresholdSatisfied: false }), result({ sli: sli({ metric: 'm2' }) })],
      { backend: 'absent' },
    );
    const counts = countByStatus(m);
    expect(counts['no-metric-store']).toBe(2);
    expect(counts.green).toBe(0);
    expect(counts.red).toBe(0);
  });
});
