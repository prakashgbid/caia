import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendGreenIds, appendRun, buildRunRow, buildStatusSnapshot, classify,
  computeNewGreenIds, flattenForPostgres, greenKey, loadAttestedGreenSet,
  loadRecentRuns, readStatusSnapshot, writeStatusSnapshot,
} from '../src/attestation.js';
import { buildAttestationMatrix } from '../src/manifest-cross-check.js';
import type { AttestationCell, AttestationMatrix, ScannerKind, ScannerToolingState } from '../src/types.js';

let TMP: string;
beforeEach(async () => { TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'us-att-')); });
afterEach(async () => { await fs.rm(TMP, { recursive: true, force: true }); });

const presentAll: Record<ScannerKind, ScannerToolingState> = {
  knip: 'present', depcheck: 'present', 'ts-prune': 'present', 'dependency-cruiser': 'present',
};

function cell(name: string, status: AttestationCell['status'] = 'green'): AttestationCell {
  return {
    packageName: name, solutionId: null, status,
    expectedImportCount: 0, satisfiedImportCount: 0,
    expectedExportCount: 0, reachableExportCount: 0,
    orphanCount: 0, unusedDepCount: 0, missingDepCount: 0, circularDepCount: 0,
    scannerStates: presentAll, observations: [],
  };
}
const M = (cs: AttestationCell[]): AttestationMatrix => buildAttestationMatrix(cs);

describe('buildRunRow + buildStatusSnapshot', () => {
  it('summary counts match cell statuses', () => {
    const matrix = M([cell('a','green'), cell('b','red'), cell('c','yellow')]);
    const row = buildRunRow({
      runId: 'fixed', startedAt: new Date('2026-05-25T00:00:00Z'),
      finishedAt: new Date('2026-05-25T00:00:01Z'),
      site: 'caia-mac', packagesRoot: '/tmp', scannerStates: presentAll, matrix,
    });
    expect(row.summary).toEqual({ green: 1, yellow: 1, red: 1, noTooling: 0, unknown: 0 });
    expect(row.runId).toBe('fixed');
  });
  it('snapshot cells sorted alphabetically', () => {
    const matrix = M([cell('b'), cell('a')]);
    const row = buildRunRow({ startedAt: new Date(), finishedAt: new Date(), site: 's', packagesRoot: '/r', scannerStates: presentAll, matrix });
    expect(buildStatusSnapshot(row, matrix).cells.map(c => c.packageName)).toEqual(['a','b']);
  });
});

describe('JSONL + status round-trip', () => {
  it('append + load preserves rows', async () => {
    const matrix = M([cell('x')]);
    const row = buildRunRow({ startedAt: new Date(), finishedAt: new Date(), site: 's', packagesRoot: '/r', scannerStates: presentAll, matrix });
    const p = path.join(TMP, 'runs.jsonl');
    await appendRun(p, row);
    await appendRun(p, row);
    expect((await loadRecentRuns(p, 5)).length).toBe(2);
  });
  it('loadRecentRuns is [] when file missing', async () => {
    expect(await loadRecentRuns(path.join(TMP,'no.jsonl'), 5)).toEqual([]);
  });
  it('writeStatusSnapshot is atomic + readable', async () => {
    const matrix = M([cell('y','green')]);
    const row = buildRunRow({ startedAt: new Date(), finishedAt: new Date(), site: 's', packagesRoot: '/r', scannerStates: presentAll, matrix });
    const p = path.join(TMP,'status.json');
    await writeStatusSnapshot(p, buildStatusSnapshot(row, matrix));
    const back = await readStatusSnapshot(p);
    expect(back?.latestRunId).toBe(row.runId);
  });
  it('readStatusSnapshot is null when missing', async () => {
    expect(await readStatusSnapshot(path.join(TMP,'no.json'))).toBeNull();
  });
});

describe('green-id attestation list', () => {
  it('loadAttestedGreenSet [] when missing', async () => {
    expect((await loadAttestedGreenSet(path.join(TMP,'no.jsonl'))).size).toBe(0);
  });
  it('computeNewGreenIds skips already-attested + skips non-green', () => {
    const matrix = M([cell('a','green'), cell('b','green'), cell('c','red')]);
    const row = buildRunRow({ startedAt: new Date(), finishedAt: new Date(), site: 's', packagesRoot: '/r', scannerStates: presentAll, matrix });
    const already = new Set([greenKey('a','s')]);
    expect(computeNewGreenIds(row, matrix, already).map(g => g.packageName)).toEqual(['b']);
  });
  it('appendGreenIds round-trips through loadAttestedGreenSet', async () => {
    const p = path.join(TMP,'attestations.jsonl');
    await appendGreenIds(p, [{ packageName:'a', solutionId:null, runId:'r1', attestedAt:'2026-05-25', site:'caia-mac' }]);
    expect((await loadAttestedGreenSet(p)).has(greenKey('a','caia-mac'))).toBe(true);
  });
});

describe('flattenForPostgres + classify', () => {
  it('emits one row per cell', () => {
    const matrix = M([cell('a'), cell('b')]);
    const row = buildRunRow({ startedAt: new Date(), finishedAt: new Date(), site: 's', packagesRoot: '/r', scannerStates: presentAll, matrix });
    expect(flattenForPostgres(row, matrix).length).toBe(2);
  });
  it('classify pass-through', () => {
    expect(classify(cell('a','red'))).toBe('red');
  });
});
