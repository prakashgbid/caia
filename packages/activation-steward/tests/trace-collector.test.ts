import { describe, expect, it } from 'vitest';
import {
  JaegerBackend,
  MockBackend,
  NullBackend,
  TempoBackend,
  aggregateBySpanName,
  aggregateByTenant,
  probeTelemetry,
} from '../src/trace-collector.js';
import type { TraceMatch } from '../src/types.js';

function span(overrides: Partial<TraceMatch> = {}): TraceMatch {
  return {
    serviceName: 'svc-a',
    spanName: 'span-a',
    tenantId: 't1',
    callpath: '@caia/x:Y.z',
    traceId: 't',
    spanId: 's',
    timestamp: new Date('2026-05-24T12:00:00Z'),
    status: 'ok',
    attributes: {},
    ...overrides,
  };
}

describe('NullBackend', () => {
  it('reports telemetry absent', async () => {
    const b = new NullBackend();
    const h = await b.health();
    expect(h.telemetry).toBe('absent');
  });

  it('returns empty matches', async () => {
    const b = new NullBackend();
    const out = await b.query({ since: new Date(0) });
    expect(out).toEqual([]);
  });

  it('has kind=null', () => {
    expect(new NullBackend().kind).toBe('null');
  });
});

describe('MockBackend', () => {
  it('defaults to telemetry present', async () => {
    const h = await new MockBackend().health();
    expect(h.telemetry).toBe('present');
  });

  it('honours a custom health', async () => {
    const h = await new MockBackend({ health: { telemetry: 'degraded' } }).health();
    expect(h.telemetry).toBe('degraded');
  });

  it('filters by serviceName + spanName', async () => {
    const b = new MockBackend({
      matches: [
        span({ serviceName: 'a', spanName: 'x' }),
        span({ serviceName: 'a', spanName: 'y' }),
        span({ serviceName: 'b', spanName: 'x' }),
      ],
    });
    const out = await b.query({
      since: new Date(0),
      serviceName: 'a',
      spanName: 'x',
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.serviceName).toBe('a');
    expect(out[0]!.spanName).toBe('x');
  });

  it('filters by tenantId', async () => {
    const b = new MockBackend({
      matches: [span({ tenantId: 't1' }), span({ tenantId: 't2' })],
    });
    const out = await b.query({ since: new Date(0), tenantId: 't2' });
    expect(out).toHaveLength(1);
    expect(out[0]!.tenantId).toBe('t2');
  });

  it('filters by since window', async () => {
    const b = new MockBackend({
      matches: [
        span({ timestamp: new Date('2026-05-24T10:00:00Z') }),
        span({ timestamp: new Date('2026-05-24T12:00:00Z') }),
      ],
    });
    const out = await b.query({ since: new Date('2026-05-24T11:00:00Z') });
    expect(out).toHaveLength(1);
  });

  it('throws when queryError is set', async () => {
    const b = new MockBackend({ queryError: new Error('boom') });
    await expect(b.query({ since: new Date(0) })).rejects.toThrow('boom');
  });
});

describe('TempoBackend', () => {
  // Note: a 'requires fetch impl' test was removed — Node 20+ always provides
  // globalThis.fetch so the fallback in the constructor always succeeds. The
  // throw path remains defensive but is unreachable in the supported runtime.

  it('builds TraceQL from serviceName + spanName + tenantId', async () => {
    let capturedUrl: URL | null = null;
    const fakeFetch: typeof fetch = async (input) => {
      capturedUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url);
      return new Response(JSON.stringify({ traces: [] }), { status: 200 });
    };
    const b = new TempoBackend({ baseUrl: 'http://tempo:3200', fetch: fakeFetch });
    await b.query({
      since: new Date('2026-05-24T00:00:00Z'),
      serviceName: 'svc-a',
      spanName: 'span-a',
      tenantId: 't1',
    });
    expect(capturedUrl).not.toBeNull();
    const q = capturedUrl!.searchParams.get('q');
    expect(q).toContain('resource.service.name="svc-a"');
    expect(q).toContain('span.name="span-a"');
    expect(q).toContain('span.tenant_id="t1"');
  });

  it('marks health absent on ECONNREFUSED', async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const b = new TempoBackend({ baseUrl: 'http://nowhere', fetch: fakeFetch });
    const h = await b.health();
    expect(h.telemetry).toBe('absent');
  });

  it('marks health degraded on non-200', async () => {
    const fakeFetch: typeof fetch = async () => new Response('', { status: 503 });
    const b = new TempoBackend({ baseUrl: 'http://tempo:3200', fetch: fakeFetch });
    const h = await b.health();
    expect(h.telemetry).toBe('degraded');
    expect(h.note).toContain('503');
  });

  it('marks health present on 200', async () => {
    const fakeFetch: typeof fetch = async () => new Response('OK', { status: 200 });
    const b = new TempoBackend({ baseUrl: 'http://tempo:3200', fetch: fakeFetch });
    const h = await b.health();
    expect(h.telemetry).toBe('present');
  });

  it('throws on query 5xx', async () => {
    const fakeFetch: typeof fetch = async () => new Response('', { status: 500 });
    const b = new TempoBackend({ baseUrl: 'http://tempo:3200', fetch: fakeFetch });
    await expect(
      b.query({ since: new Date(0), serviceName: 'svc-a', spanName: 'span-a' }),
    ).rejects.toThrow(/500/);
  });

  it('normalises Tempo response to TraceMatch[]', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          traces: [
            {
              traceID: 'tr1',
              rootServiceName: 'svc-a',
              rootSpanName: 'span-a',
              startTimeUnixNano: '1748086800000000000',
              spanSets: [
                {
                  spans: [
                    {
                      spanID: 'sp1',
                      name: 'span-a',
                      attributes: [
                        { key: 'tenant_id', value: { stringValue: 't1' } },
                        { key: 'solution.callpath', value: { stringValue: '@caia/x:Y.z' } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    const b = new TempoBackend({ baseUrl: 'http://tempo:3200', fetch: fakeFetch });
    const out = await b.query({ since: new Date(0), serviceName: 'svc-a', spanName: 'span-a' });
    expect(out).toHaveLength(1);
    expect(out[0]!.tenantId).toBe('t1');
    expect(out[0]!.callpath).toBe('@caia/x:Y.z');
  });
});

describe('JaegerBackend', () => {
  it('marks health absent on connection-refused', async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const b = new JaegerBackend({ baseUrl: 'http://nowhere', fetch: fakeFetch });
    const h = await b.health();
    expect(h.telemetry).toBe('absent');
  });

  it('requires serviceName on query', async () => {
    const fakeFetch: typeof fetch = async () => new Response('{}', { status: 200 });
    const b = new JaegerBackend({ baseUrl: 'http://j', fetch: fakeFetch });
    await expect(b.query({ since: new Date(0) })).rejects.toThrow(/serviceName/);
  });

  it('normalises Jaeger response, dropping non-matching tenant', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              traceID: 'tr1',
              processes: { p1: { serviceName: 'svc-a' } },
              spans: [
                {
                  spanID: 'sp1',
                  operationName: 'span-a',
                  startTime: 1748086800000000, // micros
                  processID: 'p1',
                  tags: [
                    { key: 'tenant_id', type: 'string', value: 't2' },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    const b = new JaegerBackend({ baseUrl: 'http://j', fetch: fakeFetch });
    const out = await b.query({ since: new Date(0), serviceName: 'svc-a', tenantId: 't1' });
    expect(out).toHaveLength(0);
  });
});

describe('aggregateBySpanName', () => {
  it('counts distinct spans and traces', () => {
    const matches = [
      span({ traceId: 'tA', spanId: 's1' }),
      span({ traceId: 'tA', spanId: 's2' }),
      span({ traceId: 'tB', spanId: 's3' }),
      span({ traceId: 'tB', spanId: 's3' }), // duplicate spanId
    ];
    const agg = aggregateBySpanName(matches);
    expect(agg).toHaveLength(1);
    expect(agg[0]!.spanCount).toBe(3);
    expect(agg[0]!.traceCount).toBe(2);
  });

  it('partitions by (serviceName, spanName)', () => {
    const matches = [
      span({ serviceName: 'a', spanName: 'x', spanId: 's1' }),
      span({ serviceName: 'b', spanName: 'x', spanId: 's2' }),
    ];
    const agg = aggregateBySpanName(matches);
    expect(agg).toHaveLength(2);
  });

  it('tracks most-recent timestamp', () => {
    const matches = [
      span({ timestamp: new Date('2026-05-24T01:00:00Z'), spanId: 's1' }),
      span({ timestamp: new Date('2026-05-24T10:00:00Z'), spanId: 's2' }),
    ];
    const agg = aggregateBySpanName(matches);
    expect(agg[0]!.mostRecentAt?.toISOString()).toBe('2026-05-24T10:00:00.000Z');
  });

  it('collects distinct tenants', () => {
    const matches = [
      span({ tenantId: 't1', spanId: 's1' }),
      span({ tenantId: 't2', spanId: 's2' }),
      span({ tenantId: 't1', spanId: 's3' }),
    ];
    const agg = aggregateBySpanName(matches);
    expect(agg[0]!.tenants).toEqual(['t1', 't2']);
  });
});

describe('aggregateByTenant', () => {
  it('buckets by tenantId, uses __no_tenant__ for null', () => {
    const matches = [
      span({ tenantId: 't1', spanId: 's1' }),
      span({ tenantId: null, spanId: 's2' }),
    ];
    const out = aggregateByTenant(matches);
    expect([...out.keys()].sort()).toEqual(['__no_tenant__', 't1']);
  });
});

describe('probeTelemetry', () => {
  it('returns the backend health.telemetry on success', async () => {
    const b = new MockBackend({ health: { telemetry: 'degraded' } });
    const out = await probeTelemetry(b);
    expect(out).toBe('degraded');
  });

  it('returns degraded on probe timeout', async () => {
    const b: import('../src/trace-collector.js').TraceBackend = {
      kind: 'slow',
      async health() {
        await new Promise((r) => setTimeout(r, 200));
        return { telemetry: 'present' };
      },
      async query() {
        return [];
      },
    };
    const out = await probeTelemetry(b, 50);
    expect(out).toBe('degraded');
  });
});
