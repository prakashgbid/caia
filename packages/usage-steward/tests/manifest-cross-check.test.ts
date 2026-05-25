import { describe, expect, it } from 'vitest';
import {
  buildAttestationMatrix,
  classifyCell,
  countByStatus,
  crossCheckPackage,
} from '../src/manifest-cross-check.js';
import type {
  AttestationCell, DeployManifest, PackageExpectations, ScannerKind,
  ScannerResult, ScannerToolingState, UsageFinding,
} from '../src/types.js';

const emptyManifest: DeployManifest = { schemaVersion: 1, entries: [] };

const allPresent: Record<ScannerKind, ScannerToolingState> = {
  knip: 'present', depcheck: 'present', 'ts-prune': 'present', 'dependency-cruiser': 'present',
};
const allAbsent: Record<ScannerKind, ScannerToolingState> = {
  knip: 'absent', depcheck: 'absent', 'ts-prune': 'absent', 'dependency-cruiser': 'absent',
};

function pkg(name: string, partial: Partial<PackageExpectations> = {}): PackageExpectations {
  return {
    packageName: name,
    packageDir: `/tmp/${name}`,
    source: 'synthetic',
    expectedImports: [],
    expectedExports: [],
    ...partial,
  };
}

function scanResult(scanner: ScannerKind, findings: UsageFinding[] = [], tooling: ScannerToolingState = 'present'): ScannerResult {
  return { scanner, tooling, findings, durationMs: 1 };
}

describe('classifyCell', () => {
  it('returns no-tooling when every scanner is absent', () => {
    expect(classifyCell({ scannerStates: allAbsent, observations: [] })).toBe('no-tooling');
  });
  it('returns unknown when no scanner is present but some failed', () => {
    const states: Record<ScannerKind, ScannerToolingState> = {
      knip: 'failed', depcheck: 'failed', 'ts-prune': 'failed', 'dependency-cruiser': 'failed',
    };
    expect(classifyCell({ scannerStates: states, observations: [] })).toBe('unknown');
  });
  it('returns red on any error observation', () => {
    const obs = [{ packageName: 'a', observationKind: 'declared-import-missing', severity: 'error', detail: 'x', supportingFindings: [] } as const];
    expect(classifyCell({ scannerStates: allPresent, observations: obs })).toBe('red');
  });
  it('returns yellow on warn observations and no errors', () => {
    const obs = [{ packageName: 'a', observationKind: 'undeclared-orphan', severity: 'warn', detail: 'x', supportingFindings: [] } as const];
    expect(classifyCell({ scannerStates: allPresent, observations: obs })).toBe('yellow');
  });
  it('returns green when no warn/error observations', () => {
    expect(classifyCell({ scannerStates: allPresent, observations: [] })).toBe('green');
  });
});

describe('crossCheckPackage', () => {
  it('marks a clean package green', () => {
    const cell = crossCheckPackage(
      { packageName: '@caia/foo', expectations: pkg('@caia/foo'), scannerResults: [scanResult('knip')] },
      { manifest: emptyManifest },
    );
    expect(cell.status).toBe('green');
    expect(cell.orphanCount).toBe(0);
  });
  it('marks orphan-module finding as warn when package not in manifest', () => {
    const finding: UsageFinding = {
      scanner: 'dependency-cruiser', kind: 'orphan-module', severity: 'warn',
      packageName: null, filePath: '/tmp/foo/src/x.ts', symbol: null, dependency: null, message: 'orphan',
    };
    const cell = crossCheckPackage(
      { packageName: '@caia/foo', expectations: pkg('@caia/foo'), scannerResults: [scanResult('dependency-cruiser', [finding])] },
      { manifest: emptyManifest },
    );
    expect(cell.status).toBe('yellow');
    expect(cell.orphanCount).toBe(1);
  });
  it('marks orphan as red when package IS in the deploy manifest (declared-shipped-but-unused)', () => {
    const finding: UsageFinding = {
      scanner: 'knip', kind: 'unused-file', severity: 'error',
      packageName: null, filePath: '/tmp/foo/src/orphan.ts', symbol: null, dependency: null, message: 'orphan file',
    };
    const cell = crossCheckPackage(
      { packageName: '@caia/foo', expectations: pkg('@caia/foo'), scannerResults: [scanResult('knip', [finding])] },
      { manifest: { schemaVersion: 1, entries: [{ name: '@caia/foo' }] } },
    );
    expect(cell.status).toBe('red');
  });
  it('emits declared-import-missing when expected import has supporting unresolved-import finding', () => {
    const finding: UsageFinding = {
      scanner: 'knip', kind: 'unresolved-import', severity: 'error',
      packageName: null, filePath: null, symbol: 'Foo', dependency: '@caia/foo', message: 'missing',
    };
    const expectations = pkg('@caia/foo', {
      expectedImports: [{ consumer: 'apps/x', symbol: 'Foo', package: '@caia/foo' }],
    });
    const cell = crossCheckPackage(
      { packageName: '@caia/foo', expectations, scannerResults: [scanResult('knip', [finding])] },
      { manifest: emptyManifest },
    );
    expect(cell.status).toBe('red');
    expect(cell.observations.some((o) => o.observationKind === 'declared-import-missing')).toBe(true);
  });
  it('emits info observations for scanner-no-tooling when knip is absent', () => {
    const cell = crossCheckPackage(
      {
        packageName: '@caia/foo',
        expectations: pkg('@caia/foo'),
        scannerResults: [
          scanResult('knip', [], 'absent'),
          scanResult('depcheck'),
          scanResult('ts-prune'),
          scanResult('dependency-cruiser'),
        ],
      },
      { manifest: emptyManifest },
    );
    expect(cell.observations.some((o) => o.observationKind === 'scanner-no-tooling')).toBe(true);
    // present > 0 → still green-eligible if no errors
    expect(cell.status).toBe('green');
  });
});

describe('buildAttestationMatrix + countByStatus', () => {
  it('produces a sorted, deduplicated map', () => {
    const cells: AttestationCell[] = [
      { packageName: 'b', solutionId: null, status: 'green', expectedImportCount: 0, satisfiedImportCount: 0, expectedExportCount: 0, reachableExportCount: 0, orphanCount: 0, unusedDepCount: 0, missingDepCount: 0, circularDepCount: 0, scannerStates: allPresent, observations: [] },
      { packageName: 'a', solutionId: null, status: 'red', expectedImportCount: 0, satisfiedImportCount: 0, expectedExportCount: 0, reachableExportCount: 0, orphanCount: 1, unusedDepCount: 0, missingDepCount: 0, circularDepCount: 0, scannerStates: allPresent, observations: [] },
    ];
    const matrix = buildAttestationMatrix(cells);
    expect(matrix.orderedPackages).toEqual(['a', 'b']);
    const counts = countByStatus(matrix);
    expect(counts.green).toBe(1);
    expect(counts.red).toBe(1);
  });
});
