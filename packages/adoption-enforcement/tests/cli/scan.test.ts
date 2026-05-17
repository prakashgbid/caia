import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runScan, runScanCli, type GhPrViewResult, type ScanFile } from '../../src/cli/scan.js';

let root: string;
let repoRoot: string;
let outDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'caia-scan-cli-'));
  repoRoot = join(root, 'repo');
  outDir = join(root, 'out');
  mkdirSync(repoRoot, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function writePackage(name: string, indexBody: string): string {
  const pkgDir = join(repoRoot, 'packages', name);
  mkdirSync(join(pkgDir, 'src'), { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: `@chiefaia/${name}` }, null, 2));
  writeFileSync(join(pkgDir, 'src', 'index.ts'), indexBody);
  return pkgDir;
}

describe('runScan — happy paths', () => {
  it('emits new_package + new_export rows for an added @chiefaia/<x> package', () => {
    writePackage('alpha', `export const alpha = () => 'a';\nexport function helperAlpha(): number { return 1; }\n`);

    const gh: GhPrViewResult = {
      files: [
        { path: 'packages/alpha/package.json', changeType: 'ADDED', additions: 5, deletions: 0 },
        { path: 'packages/alpha/src/index.ts', changeType: 'ADDED', additions: 8, deletions: 0 },
      ],
      mergeCommit: { oid: 'sha-alpha' },
    };

    const res = runScan({
      pr: 100,
      repoRoot,
      outDir,
      runGh: () => gh,
    });

    expect(res.written).toBe(true);
    expect(existsSync(res.outPath)).toBe(true);

    const onDisk = JSON.parse(readFileSync(res.outPath, 'utf8')) as ScanFile;
    expect(onDisk.sha).toBe('sha-alpha');
    expect(onDisk.pr).toBe(100);
    expect(onDisk.version).toBe(1);

    const kinds = onDisk.artefacts.map((a) => a.kind).sort();
    expect(kinds).toEqual(['new_export', 'new_export', 'new_package']);

    const pkgArt = onDisk.artefacts.find((a) => a.kind === 'new_package')!;
    expect(pkgArt.package).toBe('@chiefaia/alpha');
    expect(pkgArt.source_path).toBe('packages/alpha/package.json');

    const exportArts = onDisk.artefacts.filter((a) => a.kind === 'new_export');
    for (const a of exportArts) {
      expect(a.package).toBe('@chiefaia/alpha');
      expect(a.source_path).toBe('packages/alpha/src/index.ts');
    }
    expect(onDisk.summary).toEqual({
      artefact_count: 3,
      new_package_count: 1,
      new_export_count: 2,
      new_external_agent_count: 0,
    });
  });

  it('emits zero rows for a docs-only PR', () => {
    const gh: GhPrViewResult = {
      files: [
        { path: 'docs/foo.md', changeType: 'MODIFIED', additions: 3, deletions: 1 },
        { path: 'reports/bar.md', changeType: 'ADDED', additions: 50, deletions: 0 },
      ],
      mergeCommit: { oid: 'sha-docs' },
    };

    const res = runScan({
      pr: 492,
      repoRoot,
      outDir,
      runGh: () => gh,
    });

    expect(res.written).toBe(true);
    expect(res.scan.artefacts).toHaveLength(0);
    expect(res.scan.summary.artefact_count).toBe(0);
    expect(res.scan.sha).toBe('sha-docs');
  });

  it('emits new_export rows when an *existing* package index.ts is modified (no double-emit for added pkgs)', () => {
    writePackage('beta', `export function brandNewBeta(): string { return 'b'; }\n`);

    const gh: GhPrViewResult = {
      files: [
        { path: 'packages/beta/src/index.ts', changeType: 'MODIFIED', additions: 2, deletions: 0 },
      ],
      mergeCommit: { oid: 'sha-mod' },
    };

    const res = runScan({ pr: 101, repoRoot, outDir, runGh: () => gh });

    expect(res.scan.artefacts).toHaveLength(1);
    const row = res.scan.artefacts[0];
    expect(row.kind).toBe('new_export');
    expect(row.identifier).toBe('brandNewBeta');
    expect(row.package).toBe('@chiefaia/beta');

    // Snapshot now written — a second scan should treat zero exports as new.
    const second = runScan({
      pr: 102,
      sha: 'sha-mod-2',
      repoRoot,
      outDir: join(root, 'out2'),
      runGh: () => ({ ...gh, mergeCommit: { oid: 'sha-mod-2' } }),
    });
    expect(second.scan.artefacts).toHaveLength(0);
  });
});

describe('runScan — idempotency', () => {
  it('skips write when scan.json already exists; --force rewrites', () => {
    const gh: GhPrViewResult = {
      files: [{ path: 'docs/x.md', changeType: 'MODIFIED', additions: 1, deletions: 0 }],
      mergeCommit: { oid: 'sha-id' },
    };

    const first = runScan({ pr: 200, repoRoot, outDir, runGh: () => gh });
    expect(first.written).toBe(true);

    const second = runScan({ pr: 200, repoRoot, outDir, runGh: () => gh });
    expect(second.written).toBe(false);
    expect(second.outPath).toBe(first.outPath);

    const forced = runScan({ pr: 200, repoRoot, outDir, runGh: () => gh, force: true });
    expect(forced.written).toBe(true);
  });
});

describe('runScan — error paths', () => {
  it('throws when --pr is non-positive', () => {
    expect(() =>
      runScan({ pr: 0, repoRoot, outDir, sha: 'x', runGh: () => ({ files: [] }) }),
    ).toThrow(/positive integer/);
  });

  it('throws when no sha can be resolved', () => {
    expect(() =>
      runScan({
        pr: 1,
        repoRoot,
        outDir,
        runGh: () => ({ files: [], mergeCommit: null }),
      }),
    ).toThrow(/merge sha/);
  });
});

describe('runScanCli — argument parsing', () => {
  it('exits 0 on --help', () => {
    const r = runScanCli(['--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('caia-adoption-run scan');
  });

  it('exits 2 when --pr is missing', () => {
    const r = runScanCli([]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--pr is required');
  });

  it('exits 2 on an unknown arg', () => {
    const r = runScanCli(['--pr', '5', '--bogus']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown arg: --bogus');
  });

  it('exits 2 when --pr is not a positive integer', () => {
    const r = runScanCli(['--pr', '-3']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('invalid number');
  });
});
