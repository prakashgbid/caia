import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectNewPackages } from '../../src/scan/detect-new-packages.js';
import type {
  GhPrFilesResponse,
  NewExportRow,
  NewPackageRow,
  ScanRow,
} from '../../src/scan/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, 'fixtures', 'new-packages');

function loadFixture(name: string): GhPrFilesResponse {
  const raw = readFileSync(join(FIXTURES, name), 'utf8');
  return JSON.parse(raw) as GhPrFilesResponse;
}

interface WritePackageOptions {
  /** Repo-root-relative dir, e.g. `packages/foo`. */
  readonly packagePath: string;
  readonly name: string;
  readonly indexSource?: string;
}

function writePackage(repoRoot: string, options: WritePackageOptions): void {
  const pkgDir = join(repoRoot, options.packagePath);
  const srcDir = join(pkgDir, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    `${JSON.stringify({ name: options.name, version: '0.0.0' }, null, 2)}\n`,
  );
  if (options.indexSource !== undefined) {
    writeFileSync(join(srcDir, 'index.ts'), options.indexSource);
  }
}

function rowsByKind<K extends ScanRow['kind']>(
  rows: readonly ScanRow[],
  kind: K,
): readonly Extract<ScanRow, { kind: K }>[] {
  return rows.filter((r): r is Extract<ScanRow, { kind: K }> => r.kind === kind);
}

describe('scan/detect-new-packages', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'detect-new-packages-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('rejects non-positive pr numbers', () => {
    expect(() => detectNewPackages(0, { repoRoot, runGh: () => ({ files: [] }) })).toThrow(
      /pr must be a positive integer/,
    );
    expect(() => detectNewPackages(-3, { repoRoot, runGh: () => ({ files: [] }) })).toThrow(
      /pr must be a positive integer/,
    );
    expect(() =>
      detectNewPackages(1.5 as unknown as number, { repoRoot, runGh: () => ({ files: [] }) }),
    ).toThrow(/pr must be a positive integer/);
  });

  it('rejects relative repoRoot', () => {
    expect(() =>
      detectNewPackages(1, { repoRoot: 'relative/path', runGh: () => ({ files: [] }) }),
    ).toThrow(/repoRoot must be an absolute path/);
  });

  it('emits one new_package row plus new_export rows for an added @chiefaia/ package', () => {
    writePackage(repoRoot, {
      packagePath: 'packages/widget',
      name: '@chiefaia/widget',
      indexSource: [
        "export const PI = 3.14;",
        "export function spin(): void {}",
        "export type WidgetId = string;",
        "export default class Widget {}",
        '',
      ].join('\n'),
    });

    const result = detectNewPackages(101, {
      repoRoot,
      runGh: () => loadFixture('pr-adds-one.json'),
    });

    expect(result.newPackages).toHaveLength(1);
    expect(result.newPackages[0]).toMatchObject({
      packagePath: 'packages/widget',
      name: '@chiefaia/widget',
    });
    expect(result.newPackages[0]?.indexPath).toBe(
      resolve(repoRoot, 'packages/widget/src/index.ts'),
    );

    const pkgRows = rowsByKind(result.rows, 'new_package');
    const expRows = rowsByKind(result.rows, 'new_export');

    expect(pkgRows).toHaveLength(1);
    expect(pkgRows[0]).toEqual<NewPackageRow>({
      kind: 'new_package',
      packagePath: 'packages/widget',
      name: '@chiefaia/widget',
    });

    expect(expRows.map((r) => `${r.identifier}:${r.decl_kind}${r.isTypeOnly ? ':T' : ''}`).sort())
      .toEqual(['PI:const', 'WidgetId:type:T', 'default:default', 'spin:function'].sort());

    for (const r of expRows) {
      expect(r.packageName).toBe('@chiefaia/widget');
      expect(r.packagePath).toBe('packages/widget');
    }
  });

  it('handles multiple added @chiefaia/ packages and ignores MODIFIED entries', () => {
    writePackage(repoRoot, {
      packagePath: 'packages/alpha',
      name: '@chiefaia/alpha',
      indexSource: 'export const A = 1;\nexport const B = 2;\n',
    });
    writePackage(repoRoot, {
      packagePath: 'packages/beta',
      name: '@chiefaia/beta',
      indexSource: 'export function go(): boolean { return true; }\n',
    });
    // The "existing" package only has a MODIFIED file in the PR — must be ignored.
    writePackage(repoRoot, {
      packagePath: 'packages/existing',
      name: '@chiefaia/existing',
      indexSource: 'export const stale = true;\n',
    });

    const result = detectNewPackages(202, {
      repoRoot,
      runGh: () => loadFixture('pr-adds-multiple.json'),
    });

    const pkgNames = rowsByKind(result.rows, 'new_package').map((r) => r.name).sort();
    expect(pkgNames).toEqual(['@chiefaia/alpha', '@chiefaia/beta']);

    const alphaExports = rowsByKind(result.rows, 'new_export')
      .filter((r) => r.packagePath === 'packages/alpha')
      .map((r) => r.identifier)
      .sort();
    expect(alphaExports).toEqual(['A', 'B']);

    const betaExports = rowsByKind(result.rows, 'new_export')
      .filter((r) => r.packagePath === 'packages/beta')
      .map((r) => r.identifier);
    expect(betaExports).toEqual(['go']);

    // Sanity: the existing package contributed nothing.
    expect(
      result.rows.some(
        (r) =>
          (r.kind === 'new_package' && r.packagePath === 'packages/existing') ||
          (r.kind === 'new_export' && r.packagePath === 'packages/existing'),
      ),
    ).toBe(false);
  });

  it('returns empty rows when the PR only modifies existing packages', () => {
    writePackage(repoRoot, {
      packagePath: 'packages/existing',
      name: '@chiefaia/existing',
      indexSource: 'export const v = 1;\n',
    });

    const result = detectNewPackages(303, {
      repoRoot,
      runGh: () => loadFixture('pr-modifies-only.json'),
    });

    expect(result.rows).toEqual([]);
    expect(result.newPackages).toEqual([]);
  });

  it('skips added packages whose name does not start with the configured prefix', () => {
    writePackage(repoRoot, {
      packagePath: 'packages/random',
      name: 'just-random',
      indexSource: 'export const x = 1;\n',
    });

    const result = detectNewPackages(404, {
      repoRoot,
      runGh: () => loadFixture('pr-non-chiefaia.json'),
    });

    expect(result.rows).toEqual([]);
    expect(result.newPackages).toEqual([]);
  });

  it('respects a custom prefix', () => {
    writePackage(repoRoot, {
      packagePath: 'packages/random',
      name: '@example/random',
      indexSource: 'export const x = 1;\n',
    });

    const result = detectNewPackages(404, {
      repoRoot,
      prefix: '@example/',
      runGh: () => loadFixture('pr-non-chiefaia.json'),
    });

    expect(result.newPackages).toHaveLength(1);
    expect(result.newPackages[0]?.name).toBe('@example/random');
  });

  it('emits a new_package row with zero exports when src/index.ts is missing', () => {
    writePackage(repoRoot, {
      packagePath: 'packages/scaffold-only',
      name: '@chiefaia/scaffold-only',
    });

    const result = detectNewPackages(505, {
      repoRoot,
      runGh: () => loadFixture('pr-no-src-index.json'),
    });

    expect(result.newPackages).toHaveLength(1);
    expect(result.newPackages[0]).toMatchObject({
      packagePath: 'packages/scaffold-only',
      name: '@chiefaia/scaffold-only',
      indexPath: null,
    });

    const pkgRows = rowsByKind(result.rows, 'new_package');
    const expRows = rowsByKind(result.rows, 'new_export');
    expect(pkgRows).toHaveLength(1);
    expect(expRows).toHaveLength(0);
  });

  it('mixed PR: separates chiefaia adds from non-chiefaia, nested, and MODIFIED entries', () => {
    writePackage(repoRoot, {
      packagePath: 'packages/chiefaia-thing',
      name: '@chiefaia/thing',
      indexSource: 'export const ok = true;\n',
    });
    writePackage(repoRoot, {
      packagePath: 'packages/external-tool',
      name: 'external-tool',
      indexSource: 'export const nope = false;\n',
    });
    writePackage(repoRoot, {
      packagePath: 'packages/already-here',
      name: '@chiefaia/already-here',
      indexSource: 'export const here = 1;\n',
    });
    // Nested package.json is NOT top-level — must be ignored even if added.
    mkdirSync(join(repoRoot, 'packages/nested/sub'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'packages/nested/sub/package.json'),
      `${JSON.stringify({ name: '@chiefaia/nested-sub' })}\n`,
    );

    const result = detectNewPackages(606, {
      repoRoot,
      runGh: () => loadFixture('pr-mixed.json'),
    });

    expect(result.newPackages).toHaveLength(1);
    expect(result.newPackages[0]?.name).toBe('@chiefaia/thing');

    const pkgRows = rowsByKind(result.rows, 'new_package');
    expect(pkgRows.map((r) => r.packagePath)).toEqual(['packages/chiefaia-thing']);

    const expRows = rowsByKind(result.rows, 'new_export');
    expect(expRows).toHaveLength(1);
    expect(expRows[0]).toEqual<NewExportRow>({
      kind: 'new_export',
      packagePath: 'packages/chiefaia-thing',
      packageName: '@chiefaia/thing',
      identifier: 'ok',
      decl_kind: 'const',
      isTypeOnly: false,
    });
  });

  it('skips added package.json paths whose working-tree file is missing (sparse checkout)', () => {
    // pr-adds-one references packages/widget — we deliberately do NOT write it.
    const result = detectNewPackages(707, {
      repoRoot,
      runGh: () => loadFixture('pr-adds-one.json'),
    });
    expect(result.rows).toEqual([]);
    expect(result.newPackages).toEqual([]);
  });

  it('emits row order: new_package first, then its new_export rows, per package', () => {
    writePackage(repoRoot, {
      packagePath: 'packages/alpha',
      name: '@chiefaia/alpha',
      indexSource: 'export const A = 1;\nexport const B = 2;\n',
    });
    writePackage(repoRoot, {
      packagePath: 'packages/beta',
      name: '@chiefaia/beta',
      indexSource: 'export function go(): boolean { return true; }\n',
    });

    const result = detectNewPackages(808, {
      repoRoot,
      runGh: () => loadFixture('pr-adds-multiple.json'),
    });

    // First row must be the new_package for the first added @chiefaia pkg
    // discovered (alpha — comes before beta in the gh response).
    expect(result.rows[0]?.kind).toBe('new_package');
    expect((result.rows[0] as NewPackageRow).packagePath).toBe('packages/alpha');

    // All new_export rows for alpha must follow before beta's new_package row.
    const betaPkgIdx = result.rows.findIndex(
      (r) => r.kind === 'new_package' && r.packagePath === 'packages/beta',
    );
    for (let i = 1; i < betaPkgIdx; i += 1) {
      expect(result.rows[i]?.kind).toBe('new_export');
      expect((result.rows[i] as NewExportRow).packagePath).toBe('packages/alpha');
    }
  });

  it('tolerates unknown changeType values without crashing', () => {
    // gh occasionally emits "RENAMED" or "COPIED". Filter logic must reject
    // anything that is not exactly "ADDED" rather than throwing.
    const result = detectNewPackages(909, {
      repoRoot,
      runGh: () => ({
        files: [
          {
            path: 'packages/renamed/package.json',
            additions: 0,
            deletions: 0,
            changeType: 'RENAMED',
          },
        ],
      }),
    });
    expect(result.rows).toEqual([]);
  });

  it('rejects empty package.json name field', () => {
    const pkgDir = join(repoRoot, 'packages/widget');
    mkdirSync(join(pkgDir, 'src'), { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '' }));
    writeFileSync(join(pkgDir, 'src/index.ts'), 'export const x = 1;\n');

    const result = detectNewPackages(1010, {
      repoRoot,
      runGh: () => loadFixture('pr-adds-one.json'),
    });
    expect(result.rows).toEqual([]);
  });
});
