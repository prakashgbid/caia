import { describe, expect, it } from 'vitest';
import {
  buildAttestationMatrix,
  classifyCell,
  countByStatus,
  getCell,
  partitionByTenant,
} from '../src/per-tenant-isolation.js';
import type {
  CrossCheckResult,
  ExpectedCallPath,
  PackageExpectations,
  TraceMatch,
} from '../src/types.js';

function cp(overrides: Partial<ExpectedCallPath> = {}): ExpectedCallPath {
  return { path: 'p', serviceName: 's', spanName: 'p', freshnessHours: 24, optional: false, ...overrides };
}

function pkg(name: string, paths: ExpectedCallPath[]): PackageExpectations {
  return { packageName: name, source: 'package.json', expectedCallPaths: paths };
}

function result(overrides: Partial<CrossCheckResult> = {}): CrossCheckResult {
  return {
    packageName: '@caia/x',
    tenantId: 't1',
    callpath: cp(),
    spanCount: 0,
    traceCount: 0,
    mostRecentAt: null,
    hit: false,
    ...overrides,
  };
}

describe('partitionByTenant', () => {
  it('buckets matches by tenantId, using __no_tenant__ for null', () => {
    const matches: TraceMatch[] = [
      {
        serviceName: 's', spanName: 'p', tenantId: 't1', callpath: null,
        traceId: 'tr', spanId: 's1', timestamp: new Date(), status: 'ok', attributes: {},
      },
      {
        serviceName: 's', spanName: 'p', tenantId: null, callpath: null,
        traceId: 'tr', spanId: 's2', timestamp: new Date(), status: 'ok', attributes: {},
      },
    ];
    const out = partitionByTenant(matches);
    expect(out.has('t1')).toBe(true);
    expect(out.has('__no_tenant__')).toBe(true);
  });
});

describe('classifyCell', () => {
  const packages = [pkg('@caia/x', [cp({ path: 'A' }), cp({ path: 'B' })])];

  it('green when all paths hit', () => {
    const cell = classifyCell('@caia/x', 't1', [
      result({ callpath: cp({ path: 'A' }), hit: true }),
      result({ callpath: cp({ path: 'B' }), hit: true }),
    ], 'present', packages);
    expect(cell.status).toBe('green');
    expect(cell.hitPathCount).toBe(2);
  });

  it('yellow when some paths hit', () => {
    const cell = classifyCell('@caia/x', 't1', [
      result({ callpath: cp({ path: 'A' }), hit: true }),
      result({ callpath: cp({ path: 'B' }), hit: false }),
    ], 'present', packages);
    expect(cell.status).toBe('yellow');
    expect(cell.hitPathCount).toBe(1);
  });

  it('red when no paths hit and at least one path is required', () => {
    const cell = classifyCell('@caia/x', 't1', [
      result({ callpath: cp({ path: 'A' }), hit: false }),
      result({ callpath: cp({ path: 'B' }), hit: false }),
    ], 'present', packages);
    expect(cell.status).toBe('red');
  });

  it('yellow when no paths hit but all are optional', () => {
    const optPackages = [pkg('@caia/x', [cp({ path: 'A', optional: true })])];
    const cell = classifyCell('@caia/x', 't1', [
      result({ callpath: cp({ path: 'A', optional: true }), hit: false }),
    ], 'present', optPackages);
    expect(cell.status).toBe('yellow');
  });

  it('no-telemetry overrides every other classification', () => {
    const cell = classifyCell('@caia/x', 't1', [
      result({ callpath: cp({ path: 'A' }), hit: true }),
    ], 'absent', packages);
    expect(cell.status).toBe('no-telemetry');
  });

  it('degraded promotes a would-be-red to unknown', () => {
    const cell = classifyCell('@caia/x', 't1', [
      result({ callpath: cp({ path: 'A' }), hit: false }),
    ], 'degraded', packages);
    expect(cell.status).toBe('unknown');
  });

  it('degraded keeps green green', () => {
    const cell = classifyCell('@caia/x', 't1', [
      result({ callpath: cp({ path: 'A' }), hit: true }),
      result({ callpath: cp({ path: 'B' }), hit: true }),
    ], 'degraded', packages);
    expect(cell.status).toBe('green');
  });
});

describe('buildAttestationMatrix', () => {
  const packages = [pkg('@caia/x', [cp({ path: 'A' })]), pkg('@caia/y', [cp({ path: 'B' })])];

  it('produces one cell per (package, tenant) pair', () => {
    const results: CrossCheckResult[] = [
      result({ packageName: '@caia/x', tenantId: 't1', callpath: cp({ path: 'A' }), hit: true }),
      result({ packageName: '@caia/x', tenantId: 't2', callpath: cp({ path: 'A' }), hit: false }),
      result({ packageName: '@caia/y', tenantId: 't1', callpath: cp({ path: 'B' }), hit: true }),
    ];
    const matrix = buildAttestationMatrix(results, { telemetry: 'present', packages });
    expect(matrix.cells.size).toBe(3);
    expect(matrix.packages).toEqual(['@caia/x', '@caia/y']);
    expect(matrix.tenants.sort()).toEqual(['t1', 't2']);
  });

  it('synthesises a no-tenant cell for packages with no results', () => {
    const matrix = buildAttestationMatrix([], { telemetry: 'present', packages });
    expect(matrix.cells.size).toBe(2);
    const c = getCell(matrix, '@caia/x', '__no_tenant__');
    expect(c?.status).toBe('red'); // declared path, no hits
  });

  it('marks every cell no-telemetry when telemetry absent', () => {
    const results: CrossCheckResult[] = [
      result({ packageName: '@caia/x', tenantId: 't1', callpath: cp({ path: 'A' }), hit: true }),
    ];
    const matrix = buildAttestationMatrix(results, { telemetry: 'absent', packages });
    for (const cell of matrix.cells.values()) {
      expect(cell.status).toBe('no-telemetry');
    }
  });
});

describe('countByStatus', () => {
  const packages = [pkg('@caia/x', [cp({ path: 'A' })])];

  it('counts each status bucket', () => {
    const matrix = buildAttestationMatrix(
      [
        result({ packageName: '@caia/x', tenantId: 't1', hit: true, callpath: cp({ path: 'A' }) }),
        result({ packageName: '@caia/x', tenantId: 't2', hit: false, callpath: cp({ path: 'A' }) }),
      ],
      { telemetry: 'present', packages },
    );
    const counts = countByStatus(matrix);
    expect(counts.green + counts.red + counts.yellow + counts['no-telemetry'] + counts.unknown).toBe(2);
    expect(counts.green).toBe(1);
    expect(counts.red).toBe(1);
  });
});

describe('getCell', () => {
  it('returns the cell or undefined', () => {
    const packages = [pkg('@caia/x', [cp({ path: 'A' })])];
    const matrix = buildAttestationMatrix(
      [result({ packageName: '@caia/x', tenantId: 't1', hit: true, callpath: cp({ path: 'A' }) })],
      { telemetry: 'present', packages },
    );
    expect(getCell(matrix, '@caia/x', 't1')?.status).toBe('green');
    expect(getCell(matrix, '@caia/x', 'tNONE')).toBeUndefined();
  });
});
