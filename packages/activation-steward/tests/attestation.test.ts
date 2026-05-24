import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendRun,
  buildRunRow,
  buildStatusSnapshot,
  classify,
  flattenForPostgres,
  loadRecentRuns,
  readStatusSnapshot,
  writeStatusSnapshot,
} from '../src/attestation.js';
import { buildAttestationMatrix } from '../src/per-tenant-isolation.js';
import type {
  AttestationCell,
  CrossCheckResult,
  ExpectedCallPath,
  PackageExpectations,
  RunRow,
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

async function mkTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'activation-steward-att-'));
}

describe('buildRunRow', () => {
  it('produces an ISO-8601 run row with a deterministic runId prefix', () => {
    const packages = [pkg('@caia/x', [cp({ path: 'A' })])];
    const matrix = buildAttestationMatrix(
      [result({ callpath: cp({ path: 'A' }), hit: true })],
      { telemetry: 'present', packages },
    );
    const row = buildRunRow({
      startedAt: new Date('2026-05-24T18:00:00Z'),
      finishedAt: new Date('2026-05-24T18:00:01Z'),
      site: 'caia-mac',
      telemetry: 'present',
      windowHours: 24,
      matrix,
    });
    expect(row.runId).toMatch(/^actrun_/);
    expect(row.startedAt).toBe('2026-05-24T18:00:00.000Z');
    expect(row.finishedAt).toBe('2026-05-24T18:00:01.000Z');
    expect(row.attestations).toHaveLength(1);
    expect(row.attestations[0]!.status).toBe('green');
    expect(row.summary.green).toBe(1);
  });

  it('counts each status bucket independently', () => {
    const packages = [pkg('@caia/x', [cp({ path: 'A' })]), pkg('@caia/y', [cp({ path: 'B' })])];
    const matrix = buildAttestationMatrix(
      [
        result({ packageName: '@caia/x', tenantId: 't1', callpath: cp({ path: 'A' }), hit: true }),
        result({ packageName: '@caia/y', tenantId: 't1', callpath: cp({ path: 'B' }), hit: false }),
      ],
      { telemetry: 'present', packages },
    );
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'caia-mac', telemetry: 'present', windowHours: 24, matrix,
    });
    expect(row.summary.green).toBe(1);
    expect(row.summary.red).toBe(1);
  });

  it('respects a custom runId', () => {
    const matrix = buildAttestationMatrix([], { telemetry: 'present', packages: [] });
    const row = buildRunRow({
      runId: 'actrun_custom',
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'present', windowHours: 24, matrix,
    });
    expect(row.runId).toBe('actrun_custom');
  });
});

describe('appendRun + loadRecentRuns', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('creates parent dirs and writes a JSON-per-line entry', async () => {
    const matrix = buildAttestationMatrix([], { telemetry: 'present', packages: [] });
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'present', windowHours: 24, matrix,
    });
    const p = path.join(dir, 'nested', 'runs.jsonl');
    await appendRun(p, row);
    const text = await fs.readFile(p, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text.trim()).runId).toBe(row.runId);
  });

  it('returns the most recent N entries', async () => {
    const p = path.join(dir, 'runs.jsonl');
    const matrix = buildAttestationMatrix([], { telemetry: 'present', packages: [] });
    for (let i = 0; i < 5; i++) {
      const row: RunRow = { ...buildRunRow({
        runId: `actrun_${i}`,
        startedAt: new Date(), finishedAt: new Date(),
        site: 'x', telemetry: 'present', windowHours: 24, matrix,
      }) };
      await appendRun(p, row);
    }
    const last3 = await loadRecentRuns(p, 3);
    expect(last3.map((r) => r.runId)).toEqual(['actrun_2', 'actrun_3', 'actrun_4']);
  });

  it('returns [] when the file is missing', async () => {
    const out = await loadRecentRuns(path.join(dir, 'nope.jsonl'), 5);
    expect(out).toEqual([]);
  });

  it('skips malformed lines without crashing', async () => {
    const p = path.join(dir, 'runs.jsonl');
    await fs.writeFile(p, '{"runId":"ok","site":"x","telemetry":"present","attestations":[],"summary":{"green":0,"yellow":0,"red":0,"noTelemetry":0,"unknown":0},"startedAt":"x","finishedAt":"x","windowHours":24}\nGARBAGE\n');
    const out = await loadRecentRuns(p, 5);
    expect(out).toHaveLength(1);
  });
});

describe('writeStatusSnapshot + readStatusSnapshot', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('writes atomically via rename', async () => {
    const packages = [pkg('@caia/x', [cp({ path: 'A' })])];
    const matrix = buildAttestationMatrix(
      [result({ callpath: cp({ path: 'A' }), hit: true })],
      { telemetry: 'present', packages },
    );
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'present', windowHours: 24, matrix,
    });
    const snap = buildStatusSnapshot(row, matrix);
    const p = path.join(dir, 'status.json');
    await writeStatusSnapshot(p, snap);
    const read = await readStatusSnapshot(p);
    expect(read?.latestRunId).toBe(row.runId);
    expect(read?.cells).toHaveLength(1);
  });

  it('returns null when status snapshot missing', async () => {
    const read = await readStatusSnapshot(path.join(dir, 'nope.json'));
    expect(read).toBeNull();
  });
});

describe('classify', () => {
  it('echoes the cell status', () => {
    const c: AttestationCell = {
      packageName: '@caia/x',
      tenantId: 't1',
      status: 'green',
      expectedPathCount: 1,
      hitPathCount: 1,
      callpathResults: [],
    };
    expect(classify(c)).toBe('green');
  });
});

describe('flattenForPostgres', () => {
  it('emits one row per (run, package, tenant, callpath)', () => {
    const packages = [pkg('@caia/x', [cp({ path: 'A' }), cp({ path: 'B' })])];
    const matrix = buildAttestationMatrix(
      [
        result({ callpath: cp({ path: 'A' }), hit: true }),
        result({ callpath: cp({ path: 'B' }), hit: false }),
      ],
      { telemetry: 'present', packages },
    );
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'present', windowHours: 24, matrix,
    });
    const flat = flattenForPostgres(row, matrix);
    expect(flat).toHaveLength(2);
    expect(flat.map((r) => r.callpath).sort()).toEqual(['A', 'B']);
  });

  it('emits a synthetic row for cells with no per-callpath results', () => {
    const packages = [pkg('@caia/x', [cp({ path: 'A' })])];
    const matrix = buildAttestationMatrix([], { telemetry: 'present', packages });
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'present', windowHours: 24, matrix,
    });
    const flat = flattenForPostgres(row, matrix);
    expect(flat).toHaveLength(1);
    expect(flat[0]!.callpath).toBe('__synthetic__');
  });
});
