import { describe, expect, it } from 'vitest';
import {
  crossCheck,
  crossCheckFromSeries,
  sliKey,
} from '../src/manifest-cross-check.js';
import { MockBackend } from '../src/metric-collector.js';
import type { ExpectedSli, MetricSeries, PackageExpectations } from '../src/types.js';

function sli(overrides: Partial<ExpectedSli> = {}): ExpectedSli {
  return {
    metric: 'pkg:m',
    query: 'rate(x[5m])',
    threshold: 1.0,
    direction: 'gt',
    trendDirection: 'any',
    freshnessHours: 24,
    optional: false,
    ...overrides,
  };
}

function exp(packageName: string, slis: ExpectedSli[], solutionId?: string): PackageExpectations {
  return {
    packageName,
    ...(solutionId !== undefined ? { solutionId } : {}),
    source: 'package.json',
    expectedSli: slis,
  };
}

describe('sliKey', () => {
  it('is a stable composite key', () => {
    expect(sliKey('@caia/x', 'sol', 'm')).toBe('@caia/x::sol::m');
  });
});

describe('crossCheckFromSeries', () => {
  it('emits a synthetic no-metric-declared row for empty expectations', () => {
    const out = crossCheckFromSeries(
      [{ packageName: '@caia/x', expectations: null }],
      new Map(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.sli.metric).toBe('__no_metric_declared__');
    expect(out[0]!.metricPresent).toBe(false);
  });

  it('emits one row per declared SLI', () => {
    const e = exp('@caia/x', [sli({ metric: 'm1' }), sli({ metric: 'm2', query: 'rate(y[5m])' })]);
    const out = crossCheckFromSeries(
      [{ packageName: '@caia/x', expectations: e }],
      new Map(),
    );
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.sli.metric).sort()).toEqual(['m1', 'm2']);
  });

  it('marks threshold satisfied when latest sample is above gt threshold', () => {
    const e = exp('@caia/x', [sli({ threshold: 1, direction: 'gt' })]);
    const series: MetricSeries = {
      query: 'rate(x[5m])',
      metric: 'pkg:m',
      samples: [[100, 0.5], [200, 1.5]],
      labels: {},
    };
    const out = crossCheckFromSeries(
      [{ packageName: '@caia/x', expectations: e }],
      new Map([[series.query, series]]),
    );
    expect(out[0]!.thresholdSatisfied).toBe(true);
    expect(out[0]!.latestValue).toBe(1.5);
  });

  it('marks threshold failed when latest value violates lt', () => {
    const e = exp('@caia/x', [sli({ threshold: 1, direction: 'lt', query: 'qx' })]);
    const series: MetricSeries = {
      query: 'qx',
      metric: 'm',
      samples: [[100, 2]],
      labels: {},
    };
    const out = crossCheckFromSeries(
      [{ packageName: '@caia/x', expectations: e }],
      new Map([[series.query, series]]),
    );
    expect(out[0]!.thresholdSatisfied).toBe(false);
  });

  it('reports trend direction up when slope is positive', () => {
    const e = exp('@caia/x', [sli({ query: 'qz', trendDirection: 'up' })]);
    const series: MetricSeries = {
      query: 'qz',
      metric: 'm',
      samples: [[0, 0], [1, 1], [2, 2]],
      labels: {},
    };
    const out = crossCheckFromSeries(
      [{ packageName: '@caia/x', expectations: e }],
      new Map([[series.query, series]]),
    );
    expect(out[0]!.trend).toBe('up');
    expect(out[0]!.trendSatisfied).toBe(true);
  });

  it('fails trend gate when the slope is opposite of the declared direction', () => {
    const e = exp('@caia/x', [sli({ query: 'qd', threshold: 0, direction: 'gte', trendDirection: 'down' })]);
    const series: MetricSeries = {
      query: 'qd',
      metric: 'm',
      samples: [[0, 0], [1, 1], [2, 2]],
      labels: {},
    };
    const out = crossCheckFromSeries(
      [{ packageName: '@caia/x', expectations: e }],
      new Map([[series.query, series]]),
    );
    expect(out[0]!.trend).toBe('up');
    expect(out[0]!.trendSatisfied).toBe(false);
  });

  it('flags metric as not present when series is empty', () => {
    const e = exp('@caia/x', [sli({ query: 'qe' })]);
    const out = crossCheckFromSeries(
      [{ packageName: '@caia/x', expectations: e }],
      new Map(),
    );
    expect(out[0]!.metricPresent).toBe(false);
    expect(out[0]!.thresholdSatisfied).toBe(false);
    expect(out[0]!.sampleCount).toBe(0);
  });

  it('uses solutionId from manifest if expectations have none', () => {
    const e: PackageExpectations = {
      packageName: '@caia/x',
      source: 'package.json',
      expectedSli: [sli({ query: 'q1' })],
    };
    const out = crossCheckFromSeries(
      [{ packageName: '@caia/x', expectations: e, solutionIdFromManifest: 'sol-1' }],
      new Map(),
    );
    expect(out[0]!.solutionId).toBe('sol-1');
  });
});

describe('crossCheck (async, with backend)', () => {
  it('queries the backend per SLI', async () => {
    const series: MetricSeries = { query: 'q1', metric: 'm', samples: [[100, 5]], labels: {} };
    const backend = new MockBackend({ series: new Map([['q1', series]]) });
    const e = exp('@caia/x', [sli({ query: 'q1', threshold: 1, direction: 'gt' })]);
    const out = await crossCheck(backend, [{ packageName: '@caia/x', expectations: e }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.thresholdSatisfied).toBe(true);
    expect(out[0]!.latestValue).toBe(5);
  });

  it('treats backend errors as no-data (does not throw)', async () => {
    const backend = new MockBackend({ queryError: new Error('boom') });
    const e = exp('@caia/x', [sli({ query: 'qq' })]);
    const out = await crossCheck(backend, [{ packageName: '@caia/x', expectations: e }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.metricPresent).toBe(false);
  });
});
