import { describe, expect, it } from 'vitest';
import { callpathKey, crossCheck, crossCheckFromMatches } from '../src/manifest-cross-check.js';
import { MockBackend } from '../src/trace-collector.js';
import type { PackageExpectations, TraceMatch } from '../src/types.js';

const NOW = new Date('2026-05-24T18:00:00Z');

function pkg(callpaths: PackageExpectations['expectedCallPaths']): PackageExpectations {
  return {
    packageName: '@caia/x',
    source: 'package.json',
    expectedCallPaths: callpaths,
  };
}

function span(overrides: Partial<TraceMatch> = {}): TraceMatch {
  return {
    serviceName: 'svc-a',
    spanName: 'Y.z',
    tenantId: 't1',
    callpath: '@caia/x:Y.z',
    traceId: 'tr1',
    spanId: 's1',
    timestamp: new Date('2026-05-24T17:30:00Z'),
    status: 'ok',
    attributes: {},
    ...overrides,
  };
}

describe('crossCheck (live backend)', () => {
  it('marks a hit when the backend returns matching spans', async () => {
    const backend = new MockBackend({
      matches: [span()],
    });
    const out = await crossCheck(
      backend,
      [pkg([{ path: '@caia/x:Y.z', serviceName: 'svc-a' }])],
      { now: () => NOW },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.hit).toBe(true);
    expect(out[0]!.tenantId).toBe('t1');
  });

  it('marks no hit when the backend returns nothing', async () => {
    const backend = new MockBackend({ matches: [] });
    const out = await crossCheck(
      backend,
      [pkg([{ path: '@caia/x:Y.z', serviceName: 'svc-a' }])],
      { now: () => NOW },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.hit).toBe(false);
    expect(out[0]!.tenantId).toBe('__no_tenant__');
  });

  it('treats backend errors as no-match (deterministic empty row)', async () => {
    const backend = new MockBackend({ queryError: new Error('boom') });
    const out = await crossCheck(
      backend,
      [pkg([{ path: '@caia/x:Y.z', serviceName: 'svc-a' }])],
      { now: () => NOW },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.hit).toBe(false);
  });

  it('fans out one row per tenant', async () => {
    const backend = new MockBackend({
      matches: [
        span({ tenantId: 't1', spanId: 's1' }),
        span({ tenantId: 't2', spanId: 's2' }),
      ],
    });
    const out = await crossCheck(
      backend,
      [pkg([{ path: '@caia/x:Y.z', serviceName: 'svc-a' }])],
      { now: () => NOW },
    );
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.tenantId).sort()).toEqual(['t1', 't2']);
  });

  it('honours per-callpath freshness window', async () => {
    const backend = new MockBackend({
      matches: [span({ timestamp: new Date('2026-05-24T14:00:00Z') })],
    });
    const out = await crossCheck(
      backend,
      [pkg([{ path: '@caia/x:Y.z', serviceName: 'svc-a', freshnessHours: 2 }])],
      { now: () => NOW },
    );
    // 4h-old span shouldn't match a 2h window
    expect(out[0]!.hit).toBe(false);
  });
});

describe('crossCheckFromMatches', () => {
  it('uses callpathKey to look up matches without re-querying the backend', () => {
    const map = new Map<string, ReadonlyArray<TraceMatch>>();
    map.set(callpathKey('@caia/x', '@caia/x:Y.z'), [span({ spanId: 's1' }), span({ spanId: 's2' })]);
    const out = crossCheckFromMatches(
      [pkg([{ path: '@caia/x:Y.z', serviceName: 'svc-a' }])],
      map,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.spanCount).toBe(2);
    expect(out[0]!.hit).toBe(true);
  });

  it('emits an empty no-tenant row when nothing matches', () => {
    const map = new Map<string, ReadonlyArray<TraceMatch>>();
    const out = crossCheckFromMatches(
      [pkg([{ path: '@caia/x:Y.z', serviceName: 'svc-a' }])],
      map,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.tenantId).toBe('__no_tenant__');
    expect(out[0]!.hit).toBe(false);
  });

  it('counts distinct trace ids (not just span ids)', () => {
    const map = new Map<string, ReadonlyArray<TraceMatch>>();
    map.set(callpathKey('@caia/x', '@caia/x:Y.z'), [
      span({ traceId: 'tA', spanId: 's1' }),
      span({ traceId: 'tA', spanId: 's2' }),
      span({ traceId: 'tB', spanId: 's3' }),
    ]);
    const out = crossCheckFromMatches(
      [pkg([{ path: '@caia/x:Y.z', serviceName: 'svc-a' }])],
      map,
    );
    expect(out[0]!.spanCount).toBe(3);
    expect(out[0]!.traceCount).toBe(2);
  });

  it('tracks mostRecentAt across matches', () => {
    const map = new Map<string, ReadonlyArray<TraceMatch>>();
    map.set(callpathKey('@caia/x', '@caia/x:Y.z'), [
      span({ spanId: 's1', timestamp: new Date('2026-05-24T01:00:00Z') }),
      span({ spanId: 's2', timestamp: new Date('2026-05-24T17:30:00Z') }),
    ]);
    const out = crossCheckFromMatches(
      [pkg([{ path: '@caia/x:Y.z', serviceName: 'svc-a' }])],
      map,
    );
    expect(out[0]!.mostRecentAt?.toISOString()).toBe('2026-05-24T17:30:00.000Z');
  });
});

describe('callpathKey', () => {
  it('joins package and callpath with `::`', () => {
    expect(callpathKey('@caia/x', 'Y.z')).toBe('@caia/x::Y.z');
  });
});
