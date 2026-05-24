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
  return await fs.mkdtemp(path.join(os.tmpdir(), 'activation-steward-manifest-'));
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

  it('parses entries + carries unknown keys as metadata', async () => {
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

  it('returns null when neither activation.yaml nor package.json carries activation stanza', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@caia/x' }));
    const out = await loadPackageExpectation(dir);
    expect(out).toBeNull();
  });

  it('reads from activation.yaml', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@caia/x' }));
    await fs.writeFile(path.join(dir, 'activation.yaml'),
      'packageName: "@caia/x"\nexpectedCallPaths:\n  - path: "@caia/x:Y.z"\n    serviceName: svc-x\n');
    const out = await loadPackageExpectation(dir);
    expect(out).not.toBeNull();
    expect(out!.source).toBe('activation.yaml');
    expect(out!.expectedCallPaths).toHaveLength(1);
    expect(out!.expectedCallPaths[0]!.spanName).toBe('Y.z'); // default from path
    expect(out!.expectedCallPaths[0]!.freshnessHours).toBe(24);
    expect(out!.expectedCallPaths[0]!.optional).toBe(false);
  });

  it('prefers package.json over activation.yaml on conflict', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: '@caia/x',
      caia: { activation: { expectedCallPaths: [{ path: 'pkg-json:fn', serviceName: 'svc' }] } },
    }));
    await fs.writeFile(path.join(dir, 'activation.yaml'),
      'packageName: "@caia/x"\nexpectedCallPaths:\n  - path: yaml:fn\n    serviceName: svc\n');
    const out = await loadPackageExpectation(dir);
    expect(out!.source).toBe('package.json');
    expect(out!.expectedCallPaths[0]!.path).toBe('pkg-json:fn');
  });

  it('respects custom freshnessHours + optional flags', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: '@caia/x',
      caia: {
        activation: {
          expectedCallPaths: [{
            path: 'svc:fn', serviceName: 'svc', freshnessHours: 6, optional: true,
          }],
        },
      },
    }));
    const out = await loadPackageExpectation(dir);
    expect(out!.expectedCallPaths[0]!.freshnessHours).toBe(6);
    expect(out!.expectedCallPaths[0]!.optional).toBe(true);
  });
});

describe('loadPackageExpectations', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('returns empty when packages root missing', async () => {
    const out = await loadPackageExpectations(path.join(dir, 'nothing'));
    expect(out).toEqual([]);
  });

  it('loads multiple packages and sorts by name', async () => {
    for (const name of ['@caia/b', '@caia/a']) {
      const pkgDir = path.join(dir, name.replace('@caia/', ''));
      await fs.mkdir(pkgDir, { recursive: true });
      await fs.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({
        name,
        caia: { activation: { expectedCallPaths: [{ path: `${name}:fn`, serviceName: 'svc' }] } },
      }));
    }
    const out = await loadPackageExpectations(dir);
    expect(out).toHaveLength(2);
    expect(out[0]!.packageName).toBe('@caia/a');
    expect(out[1]!.packageName).toBe('@caia/b');
  });

  it('skips packages without activation declarations', async () => {
    const pkgDir = path.join(dir, 'x');
    await fs.mkdir(pkgDir);
    await fs.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@caia/x' }));
    const out = await loadPackageExpectations(dir);
    expect(out).toEqual([]);
  });
});

describe('joinManifestAndExpectations', () => {
  it('returns every expectation when manifest is empty', () => {
    const out = joinManifestAndExpectations(
      { schemaVersion: 1, entries: [] },
      [{
        packageName: '@caia/x', source: 'package.json',
        expectedCallPaths: [{ path: 'p', serviceName: 's' }],
      }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.entry).toBeNull();
  });

  it('inner-joins by package name', () => {
    const out = joinManifestAndExpectations(
      { schemaVersion: 1, entries: [{ name: '@caia/y' }] },
      [
        { packageName: '@caia/x', source: 'package.json', expectedCallPaths: [{ path: 'p', serviceName: 's' }] },
        { packageName: '@caia/y', source: 'package.json', expectedCallPaths: [{ path: 'q', serviceName: 's' }] },
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.expectations.packageName).toBe('@caia/y');
  });
});
