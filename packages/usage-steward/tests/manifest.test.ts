import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  declaredShippedNames,
  joinManifestAndExpectations,
  loadDeployManifest,
  loadPackageExpectation,
  loadPackageExpectations,
} from '../src/manifest.js';

let TMP: string;

beforeEach(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-steward-mft-'));
});
afterEach(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});

async function writePkg(rel: string, pkgJson: object, opts: { usageYaml?: string } = {}): Promise<string> {
  const dir = path.join(TMP, rel);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));
  if (opts.usageYaml !== undefined) {
    await fs.writeFile(path.join(dir, 'usage.yaml'), opts.usageYaml);
  }
  return dir;
}

describe('loadDeployManifest', () => {
  it('returns empty manifest when file is missing', async () => {
    const out = await loadDeployManifest(path.join(TMP, 'no-such.yaml'));
    expect(out.entries).toEqual([]);
    expect(out.schemaVersion).toBe(1);
  });
  it('parses entries with extra metadata into the metadata field', async () => {
    const p = path.join(TMP, 'deploy.yaml');
    await fs.writeFile(p, `schema_version: 1\nentries:\n  - name: "@caia/foo"\n    path: packages/foo\n    solutionId: caia-2026-05-25-foo\n    owner: ea\n`);
    const out = await loadDeployManifest(p);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]?.name).toBe('@caia/foo');
    expect(out.entries[0]?.solutionId).toBe('caia-2026-05-25-foo');
    expect(out.entries[0]?.metadata?.owner).toBe('ea');
  });
});

describe('loadPackageExpectation', () => {
  it('returns null for a directory with no package.json + no usage.yaml', async () => {
    const dir = path.join(TMP, 'empty');
    await fs.mkdir(dir, { recursive: true });
    expect(await loadPackageExpectation(dir)).toBeNull();
  });
  it('returns synthetic source when only a vanilla package.json exists', async () => {
    const dir = await writePkg('foo', { name: '@caia/foo' });
    const e = await loadPackageExpectation(dir);
    expect(e?.source).toBe('synthetic');
    expect(e?.packageName).toBe('@caia/foo');
    expect(e?.expectedImports).toEqual([]);
  });
  it('parses package.json#caia.usage when present', async () => {
    const dir = await writePkg('foo', {
      name: '@caia/foo',
      caia: { usage: { expectedImports: [{ consumer: 'apps/x/index.ts', symbol: 'Foo' }] } },
    });
    const e = await loadPackageExpectation(dir);
    expect(e?.source).toBe('package.json');
    expect(e?.expectedImports[0]?.symbol).toBe('Foo');
  });
  it('falls back to usage.yaml when package.json has no caia.usage stanza', async () => {
    const dir = await writePkg('foo', { name: '@caia/foo' }, {
      usageYaml: `packageName: "@caia/foo"\nexpectedExports:\n  - symbol: Hello\n`,
    });
    const e = await loadPackageExpectation(dir);
    expect(e?.source).toBe('usage.yaml');
    expect(e?.expectedExports[0]?.symbol).toBe('Hello');
  });
  it('package.json wins when both sources are present', async () => {
    const dir = await writePkg('foo', {
      name: '@caia/foo',
      caia: { usage: { expectedExports: [{ symbol: 'FromPkgJson' }] } },
    }, { usageYaml: `packageName: "@caia/foo"\nexpectedExports:\n  - symbol: FromYaml\n` });
    const e = await loadPackageExpectation(dir);
    expect(e?.source).toBe('package.json');
    expect(e?.expectedExports[0]?.symbol).toBe('FromPkgJson');
  });
});

describe('loadPackageExpectations', () => {
  it('returns [] when packagesRoot does not exist', async () => {
    expect(await loadPackageExpectations(path.join(TMP, 'nope'))).toEqual([]);
  });
  it('skips hidden directories', async () => {
    await fs.mkdir(path.join(TMP, '.hidden'), { recursive: true });
    await writePkg('visible', { name: '@caia/visible' });
    const out = await loadPackageExpectations(TMP);
    expect(out.map((e) => e.packageName)).toEqual(['@caia/visible']);
  });
});

describe('joinManifestAndExpectations', () => {
  it('returns every expectation when manifest is empty', () => {
    const out = joinManifestAndExpectations(
      { schemaVersion: 1, entries: [] },
      [{ packageName: 'a', packageDir: '/a', source: 'synthetic', expectedImports: [], expectedExports: [] }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.entry).toBeNull();
  });
  it('inner-joins to manifest names when manifest is non-empty', () => {
    const out = joinManifestAndExpectations(
      { schemaVersion: 1, entries: [{ name: 'a' }] },
      [
        { packageName: 'a', packageDir: '/a', source: 'synthetic', expectedImports: [], expectedExports: [] },
        { packageName: 'b', packageDir: '/b', source: 'synthetic', expectedImports: [], expectedExports: [] },
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.expectations.packageName).toBe('a');
  });
});

describe('declaredShippedNames', () => {
  it('returns a set of names from manifest entries', () => {
    const s = declaredShippedNames({ schemaVersion: 1, entries: [{ name: 'a' }, { name: 'b' }] });
    expect(s.has('a')).toBe(true);
    expect(s.has('c')).toBe(false);
  });
});
