/**
 * caia-architect-new scaffolder tests.
 *
 * The CLI's behaviour is "produce valid files for a given set of flags." We
 * exercise the `scaffold(args)` export in dry-run mode so tests don't write
 * to the filesystem unnecessarily.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error — bin file is a .mjs Node script, not a .ts module.
import { scaffold } from '../bin/caia-architect-new.mjs';

describe('caia-architect-new scaffolder', () => {
  it('requires --name', () => {
    expect(() => scaffold({ writes: 'foo.a' })).toThrow(/--name/);
  });

  it('rejects non-kebab-case names', () => {
    expect(() => scaffold({ name: 'FooBar', writes: 'foo.a' })).toThrow(/kebab-case/);
    expect(() => scaffold({ name: '123foo', writes: 'foo.a' })).toThrow(/kebab-case/);
    expect(() => scaffold({ name: 'foo_bar', writes: 'foo.a' })).toThrow(/kebab-case/);
  });

  it('requires --writes', () => {
    expect(() => scaffold({ name: 'foo' })).toThrow(/--writes/);
  });

  it('dry-run lists planned files without writing', () => {
    const result = scaffold({
      name: 'analytics',
      writes: 'analytics.provider,analytics.eventTaxonomy',
      'dry-run': true,
    });
    expect(result.dryRun).toBe(true);
    const relPaths = result.files.map((f: { rel: string }) => f.rel);
    expect(relPaths).toContain('package.json');
    expect(relPaths).toContain('src/contract.ts');
    expect(relPaths).toContain('src/architect.ts');
    expect(relPaths).toContain('src/index.ts');
    expect(relPaths).toContain('src/system-prompt.md');
    expect(relPaths).toContain('tests/contract.test.ts');
    expect(relPaths).toContain('README.md');
  });

  it('embeds the writes paths in the generated contract', () => {
    const result = scaffold({
      name: 'foo',
      writes: 'foo.alpha,foo.beta',
      'dry-run': true,
    });
    const contractFile = result.files.find((f: { rel: string }) => f.rel === 'src/contract.ts');
    expect(contractFile?.content).toContain("path: 'foo.alpha'");
    expect(contractFile?.content).toContain("path: 'foo.beta'");
    expect(contractFile?.content).toContain("architectName: 'foo'");
  });

  it('honors --runtime-model', () => {
    const result = scaffold({
      name: 'foo',
      writes: 'foo.a',
      'runtime-model': 'haiku',
      'dry-run': true,
    });
    const contractFile = result.files.find((f: { rel: string }) => f.rel === 'src/contract.ts');
    expect(contractFile?.content).toContain("runtimeModel: 'haiku'");
  });

  it('honors --depends-on', () => {
    const result = scaffold({
      name: 'foo',
      writes: 'foo.a',
      'depends-on': 'backend,frontend',
      'dry-run': true,
    });
    const contractFile = result.files.find((f: { rel: string }) => f.rel === 'src/contract.ts');
    expect(contractFile?.content).toContain('dependsOn: ["backend","frontend"]');
  });

  it('writes a working package to disk on a real run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caia-arch-test-'));
    try {
      const result = scaffold({
        name: 'demo',
        writes: 'demo.a,demo.b',
        'out-dir': dir,
      });
      expect(result.dryRun).toBe(false);
      expect(existsSync(join(dir, 'demo-architect', 'package.json'))).toBe(true);
      const pkg = JSON.parse(
        readFileSync(join(dir, 'demo-architect', 'package.json'), 'utf8'),
      );
      expect(pkg.name).toBe('@caia/demo-architect');
      expect(pkg.dependencies['@caia/architect-kit']).toBe('workspace:*');
      // Architect class file references contract correctly
      const arch = readFileSync(
        join(dir, 'demo-architect', 'src', 'architect.ts'),
        'utf8',
      );
      expect(arch).toContain('class DemoArchitect extends BaseArchitect');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite an existing package dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caia-arch-test-'));
    try {
      scaffold({ name: 'demo', writes: 'demo.a', 'out-dir': dir });
      expect(() => scaffold({ name: 'demo', writes: 'demo.a', 'out-dir': dir })).toThrow(
        /already exists/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
