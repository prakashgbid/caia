import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendGreenAttestations,
  appendRun,
  buildGreenAttestations,
  buildRunRow,
  buildStatusSnapshot,
  classify,
  flattenForPostgres,
  loadGreenAttestations,
  loadRecentRuns,
  readStatusSnapshot,
  writeStatusSnapshot,
} from '../src/attestation.js';
import { buildAttestationMatrix } from '../src/matrix.js';
import type { CrossCheckResult, ExpectedSli } from '../src/types.js';

async function mkTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'outcome-steward-attestation-'));
}

function sli(overrides: Partial<ExpectedSli> = {}): ExpectedSli {
  return {
    metric: 'pkg:m',
    query: 'q',
    threshold: 1,
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
    latestValue: 5,
    trendSlopePerHour: 0,
    trend: 'flat',
    thresholdSatisfied: true,
    trendSatisfied: true,
    metricPresent: true,
    sampleCount: 3,
    mostRecentAtIso: '2026-05-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('classify', () => {
  it('echoes the cell status (pure)', () => {
    const m = buildAttestationMatrix([result()], { backend: 'present' });
    const cell = [...m.cells.values()][0]!;
    expect(classify(cell)).toBe('green');
  });
});

describe('appendRun + loadRecentRuns', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('appends one JSON line per call', async () => {
    const p = path.join(dir, 'runs.jsonl');
    const m = buildAttestationMatrix([result()], { backend: 'present' });
    const run = buildRunRow({
      startedAt: new Date('2026-05-25T00:00:00Z'),
      finishedAt: new Date('2026-05-25T00:00:01Z'),
      site: 'test',
      backend: 'present',
      windowHours: 24,
      matrix: m,
    });
    await appendRun(p, run);
    await appendRun(p, run);
    const text = await fs.readFile(p, 'utf8');
    expect(text.trim().split('\n')).toHaveLength(2);
  });

  it('loadRecentRuns returns the tail of the file', async () => {
    const p = path.join(dir, 'runs.jsonl');
    const m = buildAttestationMatrix([result()], { backend: 'present' });
    for (let i = 0; i < 3; i++) {
      const row = buildRunRow({
        startedAt: new Date(`2026-05-25T0${i}:00:00Z`),
        finishedAt: new Date(`2026-05-25T0${i}:00:01Z`),
        site: 't',
        backend: 'present',
        windowHours: 24,
        matrix: m,
      });
      await appendRun(p, row);
    }
    const tail = await loadRecentRuns(p, 2);
    expect(tail).toHaveLength(2);
  });

  it('loadRecentRuns returns [] when file missing', async () => {
    const out = await loadRecentRuns(path.join(dir, 'nothing.jsonl'), 5);
    expect(out).toEqual([]);
  });
});

describe('writeStatusSnapshot + readStatusSnapshot', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('atomically writes the snapshot', async () => {
    const p = path.join(dir, 'status.json');
    const m = buildAttestationMatrix([result()], { backend: 'present' });
    const run = buildRunRow({
      startedAt: new Date('2026-05-25T00:00:00Z'),
      finishedAt: new Date('2026-05-25T00:00:01Z'),
      site: 'test',
      backend: 'present',
      windowHours: 24,
      matrix: m,
    });
    const snap = buildStatusSnapshot(run, m);
    await writeStatusSnapshot(p, snap);
    const round = await readStatusSnapshot(p);
    expect(round!.latestRunId).toBe(run.runId);
  });

  it('readStatusSnapshot returns null when missing', async () => {
    expect(await readStatusSnapshot(path.join(dir, 'nope.json'))).toBeNull();
  });
});

describe('appendGreenAttestations + loadGreenAttestations', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('no-ops on empty input', async () => {
    const p = path.join(dir, 'att.jsonl');
    await appendGreenAttestations(p, []);
    await expect(fs.access(p)).rejects.toThrow();
  });

  it('writes one line per attestation and round-trips through load', async () => {
    const p = path.join(dir, 'att.jsonl');
    const m = buildAttestationMatrix([result()], { backend: 'present' });
    const run = buildRunRow({
      startedAt: new Date('2026-05-25T00:00:00Z'),
      finishedAt: new Date('2026-05-25T00:00:01Z'),
      site: 't',
      backend: 'present',
      windowHours: 24,
      matrix: m,
    });
    const green = buildGreenAttestations(run, m);
    await appendGreenAttestations(p, green);
    const round = await loadGreenAttestations(p);
    expect(round).toHaveLength(green.length);
    expect(round[0]!.sliMetric).toBe('pkg:m');
  });
});

describe('buildRunRow + buildStatusSnapshot', () => {
  it('summarises counts correctly', () => {
    const m = buildAttestationMatrix(
      [
        result({ sli: sli({ metric: 'm1' }) }),
        result({ sli: sli({ metric: 'm2' }), thresholdSatisfied: false }),
      ],
      { backend: 'present' },
    );
    const run = buildRunRow({
      startedAt: new Date('2026-05-25T00:00:00Z'),
      finishedAt: new Date('2026-05-25T00:00:01Z'),
      site: 't',
      backend: 'present',
      windowHours: 24,
      matrix: m,
    });
    expect(run.summary.green).toBe(1);
    expect(run.summary.red).toBe(1);
    expect(run.attestations).toHaveLength(2);
  });

  it('buildStatusSnapshot sorts cells deterministically', () => {
    const m = buildAttestationMatrix(
      [
        result({ packageName: '@caia/b', sli: sli({ metric: 'm1' }) }),
        result({ packageName: '@caia/a', sli: sli({ metric: 'm1' }) }),
      ],
      { backend: 'present' },
    );
    const run = buildRunRow({
      startedAt: new Date('2026-05-25T00:00:00Z'),
      finishedAt: new Date('2026-05-25T00:00:01Z'),
      site: 't',
      backend: 'present',
      windowHours: 24,
      matrix: m,
    });
    const snap = buildStatusSnapshot(run, m);
    expect(snap.cells[0]!.packageName).toBe('@caia/a');
    expect(snap.cells[1]!.packageName).toBe('@caia/b');
  });
});

describe('buildGreenAttestations', () => {
  it('only emits rows for green cells', () => {
    const m = buildAttestationMatrix(
      [
        result({ sli: sli({ metric: 'm1' }) }),
        result({ sli: sli({ metric: 'm2' }), thresholdSatisfied: false }),
      ],
      { backend: 'present' },
    );
    const run = buildRunRow({
      startedAt: new Date('2026-05-25T00:00:00Z'),
      finishedAt: new Date('2026-05-25T00:00:01Z'),
      site: 't',
      backend: 'present',
      windowHours: 24,
      matrix: m,
    });
    const green = buildGreenAttestations(run, m);
    expect(green).toHaveLength(1);
    expect(green[0]!.sliMetric).toBe('m1');
    expect(green[0]!.value).toBe(5);
  });

  it('skips green cells with null latest value (degenerate)', () => {
    const m = buildAttestationMatrix(
      [result({ latestValue: null })],
      { backend: 'present' },
    );
    const run = buildRunRow({
      startedAt: new Date('2026-05-25T00:00:00Z'),
      finishedAt: new Date('2026-05-25T00:00:01Z'),
      site: 't',
      backend: 'present',
      windowHours: 24,
      matrix: m,
    });
    expect(buildGreenAttestations(run, m)).toEqual([]);
  });
});

describe('flattenForPostgres', () => {
  it('produces one row per cell with full metadata', () => {
    const m = buildAttestationMatrix(
      [result({ sli: sli({ metric: 'm1' }) }), result({ sli: sli({ metric: 'm2' }) })],
      { backend: 'present' },
    );
    const run = buildRunRow({
      startedAt: new Date('2026-05-25T00:00:00Z'),
      finishedAt: new Date('2026-05-25T00:00:01Z'),
      site: 't',
      backend: 'present',
      windowHours: 24,
      matrix: m,
    });
    const rows = flattenForPostgres(run, m);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.site).toBe('t');
    expect(rows[0]!.backend).toBe('present');
  });
});
