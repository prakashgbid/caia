import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  defaultSnapshotPath,
  detectNewExports,
} from '../../src/scan/detect-new-exports.js';
import { parseExports, parseExportsFromSource } from '../../src/scan/parse-exports.js';
import { diffExports, rowKey } from '../../src/scan/snapshot.js';
import type { ExportRow, ExportsSnapshot } from '../../src/scan/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, 'fixtures', 'exports');

function fixture(name: string): string {
  return join(FIXTURES, name);
}

function names(rows: readonly ExportRow[]): string[] {
  return rows.map((r) => `${r.identifier}:${r.decl_kind}${r.isTypeOnly ? ':T' : ''}`);
}

describe('scan/parse-exports', () => {
  it('extracts every declaration kind from a simple fixture', () => {
    expect(names(parseExports(fixture('simple.ts')))).toEqual([
      'helloFn:function',
      'HelloClass:class',
      'HELLO_CONST:const',
      'helloLet:let',
      'helloVar:var',
      'HelloShape:interface:T',
      'HelloAlias:type:T',
      'HelloEnum:enum',
    ]);
  });

  it('flags `export default function` as a single "default" row', () => {
    expect(names(parseExports(fixture('default-fn.ts')))).toEqual(['default:default']);
  });

  it('flags `export default class` as a single "default" row', () => {
    expect(names(parseExports(fixture('default-class.ts')))).toEqual(['default:default']);
  });

  it('flags `export default <expr>` as "default"', () => {
    expect(names(parseExports(fixture('default-expr.ts')))).toEqual(['default:default']);
  });

  it('parses a re-export list with rename + per-specifier type-only', () => {
    expect(parseExports(fixture('re-export-list.ts'))).toEqual([
      { identifier: 'foo', decl_kind: 're-export', isTypeOnly: false },
      { identifier: 'baz', decl_kind: 're-export', isTypeOnly: false },
      { identifier: 'Quux', decl_kind: 're-export', isTypeOnly: true },
    ]);
  });

  it('parses a whole-clause type-only re-export (`export type { ... }`)', () => {
    expect(parseExports(fixture('type-only-clause.ts'))).toEqual([
      { identifier: 'Alpha', decl_kind: 're-export', isTypeOnly: true },
      { identifier: 'Gamma', decl_kind: 're-export', isTypeOnly: true },
    ]);
  });

  it('does NOT emit rows for export-looking text inside string literals or comments', () => {
    expect(parseExports(fixture('string-literal-decoys.ts'))).toEqual([
      { identifier: 'realOne', decl_kind: 'const', isTypeOnly: false },
    ]);
  });

  it('emits a namespace-re-export row and skips bare `export * from`', () => {
    expect(parseExports(fixture('namespace-and-star.ts'))).toEqual([
      { identifier: 'nsThing', decl_kind: 'namespace-re-export', isTypeOnly: false },
    ]);
  });

  it('flattens destructured binding patterns in `export const { a, b }`', () => {
    expect(names(parseExports(fixture('destructured.ts')))).toEqual([
      'a:const',
      'b:const',
      'first:const',
      'third:const',
    ]);
  });

  it('also parses from raw source (no file I/O)', () => {
    expect(names(parseExportsFromSource('export const a = 1; export function b() {}'))).toEqual([
      'a:const',
      'b:function',
    ]);
  });
});

describe('scan/snapshot helpers', () => {
  const a: ExportRow = { identifier: 'a', decl_kind: 'const', isTypeOnly: false };
  const b: ExportRow = { identifier: 'b', decl_kind: 'function', isTypeOnly: false };
  const bType: ExportRow = { identifier: 'b', decl_kind: 're-export', isTypeOnly: true };

  it('diffs by (identifier, decl_kind, isTypeOnly) triple', () => {
    expect(diffExports([a], [a, b])).toEqual([b]);
    expect(diffExports([a, b], [a, b])).toEqual([]);
    expect(diffExports([b], [b, bType])).toEqual([bType]);
  });

  it('produces stable row keys', () => {
    expect(rowKey(a)).toBe('a const v');
    expect(rowKey(bType)).toBe('b re-export t');
  });
});

describe('scan/detect-new-exports', () => {
  it('rejects relative indexPath', () => {
    expect(() => detectNewExports('packages/foo/src/index.ts')).toThrow(/must be absolute/);
  });

  it('treats every export as new on first run and writes a snapshot', () => {
    const pkg = mkdtempSync(join(tmpdir(), 'detect-new-exports-'));
    try {
      const srcDir = join(pkg, 'src');
      mkdirSync(srcDir, { recursive: true });
      const indexPath = join(srcDir, 'index.ts');
      writeFileSync(indexPath, 'export const a = 1;\nexport function b() {}\n');

      const first = detectNewExports(indexPath);
      expect(first.firstRun).toBe(true);
      expect(first.exports).toHaveLength(2);
      expect(first.newExports).toEqual(first.exports);
      expect(first.snapshotPath).toBe(defaultSnapshotPath(indexPath));

      const persisted = JSON.parse(readFileSync(first.snapshotPath, 'utf8')) as ExportsSnapshot;
      expect(persisted.version).toBe(1);
      expect(persisted.exports).toEqual(first.exports);
      expect(persisted.indexPath).toBe(indexPath);

      // Idempotent second pass.
      const second = detectNewExports(indexPath);
      expect(second.firstRun).toBe(false);
      expect(second.newExports).toEqual([]);

      // Add a new export → only that one is new.
      writeFileSync(
        indexPath,
        'export const a = 1;\nexport function b() {}\nexport class C {}\n',
      );
      const third = detectNewExports(indexPath);
      expect(third.firstRun).toBe(false);
      expect(third.newExports).toEqual([
        { identifier: 'C', decl_kind: 'class', isTypeOnly: false },
      ]);
    } finally {
      rmSync(pkg, { recursive: true, force: true });
    }
  });

  it('honours a custom snapshot path and writeSnapshot=false', () => {
    const pkg = mkdtempSync(join(tmpdir(), 'detect-new-exports-'));
    try {
      const indexPath = join(pkg, 'index.ts');
      writeFileSync(indexPath, 'export const z = 1;\n');
      const snapshotPath = join(pkg, 'custom-snapshot.json');

      const result = detectNewExports(indexPath, { snapshotPath, writeSnapshot: false });
      expect(result.snapshotPath).toBe(snapshotPath);
      expect(result.firstRun).toBe(true);
      expect(existsSync(snapshotPath)).toBe(false);
    } finally {
      rmSync(pkg, { recursive: true, force: true });
    }
  });

  it('computes the default snapshot path two levels up from the index file', () => {
    const indexPath = '/repo/packages/foo/src/index.ts';
    expect(defaultSnapshotPath(indexPath)).toBe(
      '/repo/packages/foo/.adoption/exports-snapshot.json',
    );
  });

  it('throws on a malformed pre-existing snapshot', () => {
    const pkg = mkdtempSync(join(tmpdir(), 'detect-new-exports-'));
    try {
      const indexPath = join(pkg, 'index.ts');
      writeFileSync(indexPath, 'export const a = 1;\n');
      const snapshotPath = join(pkg, 'bad-snapshot.json');
      writeFileSync(snapshotPath, '{ "not": "a valid snapshot" }');
      expect(() => detectNewExports(indexPath, { snapshotPath })).toThrow(/malformed/);
    } finally {
      rmSync(pkg, { recursive: true, force: true });
    }
  });
});
