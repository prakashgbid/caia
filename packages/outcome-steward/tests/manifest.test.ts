import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  joinManifestAndExpectations,
  loadDeployManifest,
  loadPackageExpectation,
  loadPackageExpectations,
} from '../src/manifest.js';

async function mkTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'outcome-steward-manifest-'));
}

describe('loadDeployManifest', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('returns empty manifest when file missing', async () => {
    const m = await loadDeployManifest(path.join(dir, 'nothing.yaml'));
    expect(m.entries).toEqual([]);
    expect(m.schemaVersion).toBe(1);
  });

  it('returns empty entries on empty file', async () => {
    const p = path.join(dir, 'empty.yaml');
    await fs.writeFile(p, '');
    const m = await loadDeployManifest(p);
    expect(m.entries).toEqual([]);
  });

  it('parses entries with metadata fall-through', async () => {
    const p = path.join(dir, 'm.yaml');
    await fs.writeFile(p,
      'schema_version: 1\nentries:\n  - name: "@caia/x"\n    path: packages/x\n    solutionId: caia-2026-x\n    extra: hello\n');
    const m = await loadDeployManifest(p);
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0]!.name).toBe('@caia/x');
    expect(m.entries[0]!.solutionId).toBe('caia-2026-x');
    expect(m.entries[0]!.metadata).toEqual({ extra: 'hello' });
  });
});

describe('loadPackageExpectation', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('returns null when no declaration is present', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@caia/x' }));
    const out = await loadPackageExpectation(dir);
    expect(out).toBeNull();
  });

  it('reads from outcome.yaml', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@caia/x' }));
    await fs.writeFile(path.join(dir, 'outcome.yaml'),
      'packageName: "@caia/x"\nexpectedSli:\n  - metric: "@caia/x:p95"\n    query: \'histogram_quantile(0.95, http_request_duration_seconds_bucket)\'\n    threshold: 1.0\n    direction: lt\n');
    const out = await loadPackageExpectation(dir);
    expect(out).not.toBeNull();
    expect(out!.source).toBe('outcome.yaml');
    expect(out!.expectedSli).toHaveLength(1);
    expect(out!.expectedSli[0]!.threshold).toBe(1.0);
    expect(out!.expectedSli[0]!.direction).toBe('lt');
    expect(out!.expectedSli[0]!.freshnessHours).toBe(24);
    expect(out!.expectedSli[0]!.trendDirection).toBe('any');
    expect(out!.expectedSli[0]!.optional).toBe(false);
  });

  it('prefers package.json over outcome.yaml on conflict', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: '@caia/x',
      caia: {
        outcome: {
          expectedSli: [{
            metric: 'pj:rate', query: 'rate(x[5m])', threshold: 1, direction: 'gt',
          }],
        },
      },
    }));
    await fs.writeFile(path.join(dir, 'outcome.yaml'),
      'packageName: "@caia/x"\nexpectedSli:\n  - metric: yaml:rate\n    query: rate(y[5m])\n    threshold: 1\n    direction: gt\n');
    const out = await loadPackageExpectation(dir);
    expect(out!.source).toBe('package.json');
    expect(out!.expectedSli[0]!.metric).toBe('pj:rate');
  });

  it('honours custom freshnessHours and optional flags', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: '@caia/x',
      caia: {
        outcome: {
          expectedSli: [{
            metric: 'm',
            query: 'q',
            threshold: 100,
            direction: 'gte',
            trendDirection: 'up',
            freshnessHours: 6,
            optional: true,
          }],
        },
      },
    }));
    const out = await loadPackageExpectation(dir);
    expect(out!.expectedSli[0]!.freshnessHours).toBe(6);
    expect(out!.expectedSli[0]!.optional).toBe(true);
    expect(out!.expectedSli[0]!.trendDirection).toBe('up');
  });
});

describe('loadPackageExpectations', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('returns empty when root missing', async () => {
    const out = await loadPackageExpectations(path.join(dir, 'nothing'));
    expect(out).toEqual([]);
  });

  it('skips packages without declarations and sorts by name', async () => {
    for (const name of ['@caia/b', '@caia/a']) {
      const pkgDir = path.join(dir, name.replace('@caia/', ''));
      await fs.mkdir(pkgDir, { recursive: true });
      await fs.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({
        name,
        caia: {
          outcome: {
            expectedSli: [{ metric: 'm', query: 'q', threshold: 1, direction: 'gt' }],
          },
        },
      }));
    }
    const emptyDir = path.join(dir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });
    await fs.writeFile(path.join(emptyDir, 'package.json'), JSON.stringify({ name: '@caia/empty' }));

    const out = await loadPackageExpectations(dir);
    expect(out).toHaveLength(2);
    expect(out[0]!.packageName).toBe('@caia/a');
    expect(out[1]!.packageName).toBe('@caia/b');
  });
});

describe('joinManifestAndExpectations', () => {
  it('falls back to "deploy everything" when manifest is empty', () => {
    const out = joinManifestAndExpectations(
      { schemaVersion: 1, entries: [] },
      [{
        packageName: '@caia/x',
        source: 'package.json',
        expectedSli: [{
          metric: 'm', query: 'q', threshold: 1, direction: 'gt', trendDirection: 'any', freshnessHours: 24, optional: false,
        }],
      }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.entry).toBeNull();
    expect(out[0]!.packageName).toBe('@caia/x');
  });

  it('walks every manifest entry, emitting null expectations for ones without declarations', () => {
    const out = joinManifestAndExpectations(
      { schemaVersion: 1, entries: [{ name: '@caia/x' }, { name: '@caia/y' }] },
      [{
        packageName: '@caia/x',
        source: 'package.json',
        expectedSli: [{
          metric: 'm', query: 'q', threshold: 1, direction: 'gt', trendDirection: 'any', freshnessHours: 24, optional: false,
        }],
      }],
    );
    expect(out).toHaveLength(2);
    const xRow = out.find((r) => r.packageName === '@caia/x')!;
    const yRow = out.find((r) => r.packageName === '@caia/y')!;
    expect(xRow.expectations).not.toBeNull();
    expect(yRow.expectations).toBeNull();
  });
});
