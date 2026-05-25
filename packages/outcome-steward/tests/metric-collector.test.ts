import { describe, expect, it } from 'vitest';
import {
  GrafanaBackend,
  MockBackend,
  NullBackend,
  PrometheusBackend,
  classifyTrend,
  compareThreshold,
  computeSlope,
  defaultStepSeconds,
  pickMostRecent,
  probeBackend,
  trendSatisfied,
} from '../src/metric-collector.js';
import type { MetricSeries } from '../src/types.js';

describe('NullBackend', () => {
  it('always reports absent', async () => {
    const b = new NullBackend();
    const h = await b.health();
    expect(h.backend).toBe('absent');
  });

  it('returns empty series with original query string', async () => {
    const b = new NullBackend();
    const s = await b.query({ query: 'up{job="x"}', since: new Date(0) });
    expect(s.samples).toEqual([]);
    expect(s.query).toBe('up{job="x"}');
  });
});

describe('MockBackend', () => {
  it('returns the series mapped to its query string', async () => {
    const series: MetricSeries = {
      query: 'q',
      metric: 'foo',
      samples: [[100, 1], [200, 2]],
      labels: {},
    };
    const b = new MockBackend({ series: new Map([['q', series]]) });
    const out = await b.query({ query: 'q', since: new Date(0) });
    expect(out).toBe(series);
  });

  it('returns empty when the query is not in the map', async () => {
    const b = new MockBackend({ series: new Map() });
    const out = await b.query({ query: 'missing', since: new Date(0) });
    expect(out.samples).toEqual([]);
  });

  it('honours health override', async () => {
    const b = new MockBackend({ health: { backend: 'degraded', note: 'flaky' } });
    const h = await b.health();
    expect(h.backend).toBe('degraded');
  });

  it('rethrows queryError', async () => {
    const b = new MockBackend({ queryError: new Error('boom') });
    await expect(b.query({ query: 'q', since: new Date(0) })).rejects.toThrow('boom');
  });
});

describe('computeSlope', () => {
  it('returns null for fewer than 2 samples', () => {
    expect(computeSlope([])).toBeNull();
    expect(computeSlope([[1, 1]])).toBeNull();
  });

  it('returns positive slope for ascending series', () => {
    // y = t (1 unit per second = 3600 per hour)
    const slope = computeSlope([[0, 0], [1, 1], [2, 2], [3, 3]]);
    expect(slope).not.toBeNull();
    expect(slope!).toBeCloseTo(3600, 3);
  });

  it('returns negative slope for descending series', () => {
    const slope = computeSlope([[0, 3], [1, 2], [2, 1], [3, 0]]);
    expect(slope).not.toBeNull();
    expect(slope!).toBeCloseTo(-3600, 3);
  });

  it('returns near-zero slope for flat series', () => {
    const slope = computeSlope([[0, 5], [1, 5], [2, 5], [3, 5]]);
    expect(slope).toBe(0);
  });
});

describe('compareThreshold', () => {
  it.each([
    [1, 'gt', 0, true],
    [0, 'gt', 0, false],
    [1, 'gte', 1, true],
    [0, 'lt', 1, true],
    [1, 'lt', 1, false],
    [1, 'lte', 1, true],
    [1.0, 'eq', 1.0, true],
    [1.0, "eq", 1.00000000001, true],
    [1.0, 'neq', 2.0, true],
    [1.0, 'neq', 1.0, false],
  ] as const)('%s %s %s → %s', (v, dir, thresh, want) => {
    expect(compareThreshold(v, dir, thresh)).toBe(want);
  });
});

describe('classifyTrend', () => {
  it('classifies null as unknown', () => {
    expect(classifyTrend(null)).toBe('unknown');
  });
  it('classifies positive slope as up', () => {
    expect(classifyTrend(1)).toBe('up');
  });
  it('classifies negative slope as down', () => {
    expect(classifyTrend(-1)).toBe('down');
  });
  it('classifies near-zero slope as flat', () => {
    expect(classifyTrend(0)).toBe('flat');
    expect(classifyTrend(1e-12)).toBe('flat');
  });
});

describe('trendSatisfied', () => {
  it('accepts everything when expected = any', () => {
    expect(trendSatisfied('any', 'unknown')).toBe(true);
    expect(trendSatisfied('any', 'down')).toBe(true);
  });
  it('rejects unknown when an explicit trend is required', () => {
    expect(trendSatisfied('up', 'unknown')).toBe(false);
  });
  it('matches up/down/flat exactly', () => {
    expect(trendSatisfied('up', 'up')).toBe(true);
    expect(trendSatisfied('up', 'down')).toBe(false);
    expect(trendSatisfied('flat', 'flat')).toBe(true);
  });
});

describe('defaultStepSeconds', () => {
  it('returns a step ≥ 15 even for tiny windows', () => {
    const step = defaultStepSeconds(new Date(0), new Date(10_000));
    expect(step).toBeGreaterThanOrEqual(15);
  });
  it('scales roughly linearly with the window', () => {
    const sShort = defaultStepSeconds(new Date(0), new Date(3600_000)); // 1h
    const sLong = defaultStepSeconds(new Date(0), new Date(86400_000)); // 24h
    expect(sLong).toBeGreaterThan(sShort);
  });
});

describe('pickMostRecent', () => {
  it('returns null on empty', () => {
    expect(pickMostRecent({ query: 'q', metric: null, samples: [], labels: {} })).toBeNull();
  });
  it('returns the last sample', () => {
    const s = pickMostRecent({
      query: 'q',
      metric: null,
      samples: [[1, 10], [2, 20], [3, 30]],
      labels: {},
    });
    expect(s).toEqual([3, 30]);
  });
});

describe('probeBackend', () => {
  it('returns the backend state on healthy probe', async () => {
    const b = new MockBackend();
    expect(await probeBackend(b)).toBe('present');
  });
  it('returns degraded on timeout', async () => {
    const b = new MockBackend({ simulateTimeout: true });
    // health is mocked OK; only query times out. So probe returns present.
    // Build a custom backend whose health hangs.
    const slowBackend = {
      kind: 'slow',
      async health() {
        return new Promise<never>(() => {});
      },
      async query() {
        return { query: 'q', metric: null, samples: [], labels: {} };
      },
    };
    expect(await probeBackend(slowBackend, 50)).toBe('degraded');
    void b;
  });
});

describe('PrometheusBackend.health', () => {
  it('reports present on 200', async () => {
    const fakeFetch = (async () => new Response('OK', { status: 200 })) as unknown as typeof fetch;
    const b = new PrometheusBackend({ baseUrl: 'http://localhost:9090', fetch: fakeFetch });
    const h = await b.health();
    expect(h.backend).toBe('present');
  });

  it('reports degraded on non-200', async () => {
    const fakeFetch = (async () => new Response('err', { status: 500 })) as unknown as typeof fetch;
    const b = new PrometheusBackend({ baseUrl: 'http://localhost:9090', fetch: fakeFetch });
    const h = await b.health();
    expect(h.backend).toBe('degraded');
  });

  it('reports absent on connection-refused', async () => {
    const fakeFetch = (async () => {
      throw new Error('fetch failed (ECONNREFUSED)');
    }) as unknown as typeof fetch;
    const b = new PrometheusBackend({ baseUrl: 'http://localhost:9090', fetch: fakeFetch });
    const h = await b.health();
    expect(h.backend).toBe('absent');
  });

  it('normalises a query_range response', async () => {
    const responseBody = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [{
          metric: { __name__: 'foo', instance: 'i' },
          values: [[100, '1.5'], [200, '2.5']],
        }],
      },
    };
    const fakeFetch = (async () => new Response(JSON.stringify(responseBody), { status: 200 })) as unknown as typeof fetch;
    const b = new PrometheusBackend({ baseUrl: 'http://localhost:9090', fetch: fakeFetch });
    const s = await b.query({ query: 'foo', since: new Date(50_000), until: new Date(250_000) });
    expect(s.metric).toBe('foo');
    expect(s.samples).toEqual([[100, 1.5], [200, 2.5]]);
    expect(s.labels.instance).toBe('i');
  });

  it('throws on prometheus error status', async () => {
    const responseBody = { status: 'error', error: 'bad query' };
    const fakeFetch = (async () => new Response(JSON.stringify(responseBody), { status: 200 })) as unknown as typeof fetch;
    const b = new PrometheusBackend({ baseUrl: 'http://localhost:9090', fetch: fakeFetch });
    await expect(b.query({ query: 'foo', since: new Date(0) })).rejects.toThrow(/bad query/);
  });
});

describe('GrafanaBackend.health', () => {
  it('reports present on 200', async () => {
    const fakeFetch = (async () => new Response('OK', { status: 200 })) as unknown as typeof fetch;
    const b = new GrafanaBackend({
      baseUrl: 'http://grafana',
      datasourceUid: 'ds-1',
      fetch: fakeFetch,
    });
    const h = await b.health();
    expect(h.backend).toBe('present');
  });

  it('reports absent on connection refused', async () => {
    const fakeFetch = (async () => {
      throw new Error('fetch failed ECONNREFUSED');
    }) as unknown as typeof fetch;
    const b = new GrafanaBackend({
      baseUrl: 'http://grafana',
      datasourceUid: 'ds-1',
      fetch: fakeFetch,
    });
    const h = await b.health();
    expect(h.backend).toBe('absent');
  });

  it('forwards the apiKey when provided', async () => {
    let observed = '';
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      observed = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');
      return new Response(JSON.stringify({ status: 'success', data: { resultType: 'matrix', result: [] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const b = new GrafanaBackend({
      baseUrl: 'http://grafana',
      datasourceUid: 'ds-1',
      apiKey: 'k',
      fetch: fakeFetch,
    });
    await b.query({ query: 'foo', since: new Date(0) });
    expect(observed).toBe('Bearer k');
  });
});
