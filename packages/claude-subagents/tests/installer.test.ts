import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSubagents, verifyInstalled } from '../src/installer.js';
import { MANIFEST } from '../src/manifest.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'caia-claude-subagents-test-'));
});

describe('installSubagents', () => {
  it('writes every shipped .md file into the target dir on a fresh install', () => {
    const result = installSubagents({ targetDir: tmpDir });
    expect(result.writtenCount).toBe(MANIFEST.entries.length);
    expect(result.skippedCount).toBe(0);
    expect(result.overwrittenCount).toBe(0);
    for (const e of MANIFEST.entries) {
      const path = join(tmpDir, e.filename);
      expect(existsSync(path)).toBe(true);
    }
  });

  it('is idempotent — re-install on unchanged content skips every file', () => {
    installSubagents({ targetDir: tmpDir });
    const second = installSubagents({ targetDir: tmpDir });
    expect(second.writtenCount).toBe(0);
    expect(second.skippedCount).toBe(MANIFEST.entries.length);
    expect(second.overwrittenCount).toBe(0);
    for (const r of second.results) {
      expect(r.action).toBe('skipped-unchanged');
    }
  });

  it('overwrites files when --force is set', () => {
    installSubagents({ targetDir: tmpDir });
    const second = installSubagents({ targetDir: tmpDir, force: true });
    expect(second.writtenCount).toBe(0);
    expect(second.skippedCount).toBe(0);
    expect(second.overwrittenCount).toBe(MANIFEST.entries.length);
  });

  it('overwrites files that have drifted on disk', () => {
    installSubagents({ targetDir: tmpDir });
    const baFile = join(tmpDir, 'caia-ba.md');
    writeFileSync(baFile, '---\nname: caia-ba\ndescription: tampered\n---\n', 'utf-8');
    const second = installSubagents({ targetDir: tmpDir });
    const baResult = second.results.find((r) => r.name === 'caia-ba');
    expect(baResult?.action).toBe('overwritten');
    expect(second.overwrittenCount).toBe(1);
    expect(second.skippedCount).toBe(MANIFEST.entries.length - 1);
    const restored = readFileSync(baFile, 'utf-8');
    expect(restored).toContain('CAIA Business Analyst');
  });

  it('only installs the names passed via the `only` option', () => {
    const result = installSubagents({
      targetDir: tmpDir,
      only: ['caia-coding', 'caia-validator']
    });
    expect(result.writtenCount).toBe(2);
    expect(result.results.map((r) => r.name).sort()).toEqual([
      'caia-coding',
      'caia-validator'
    ]);
    expect(existsSync(join(tmpDir, 'caia-coding.md'))).toBe(true);
    expect(existsSync(join(tmpDir, 'caia-validator.md'))).toBe(true);
    expect(existsSync(join(tmpDir, 'caia-ba.md'))).toBe(false);
  });

  it('throws when an unknown subagent name is requested via --only', () => {
    expect(() =>
      installSubagents({ targetDir: tmpDir, only: ['caia-coding', 'caia-bogus'] })
    ).toThrow(/unknown subagent name/);
  });

  it('creates the target dir if it does not exist', () => {
    const nested = join(tmpDir, 'a', 'b', 'c');
    expect(existsSync(nested)).toBe(false);
    const result = installSubagents({ targetDir: nested });
    expect(existsSync(nested)).toBe(true);
    expect(result.writtenCount).toBe(MANIFEST.entries.length);
  });
});

describe('verifyInstalled', () => {
  it('reports every file as missing on a fresh empty target dir', () => {
    const result = verifyInstalled({ targetDir: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.missingCount).toBe(MANIFEST.entries.length);
    expect(result.presentCount).toBe(0);
    expect(result.driftedCount).toBe(0);
  });

  it('reports every file as present-matches after a fresh install', () => {
    installSubagents({ targetDir: tmpDir });
    const result = verifyInstalled({ targetDir: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.presentCount).toBe(MANIFEST.entries.length);
    expect(result.missingCount).toBe(0);
    expect(result.driftedCount).toBe(0);
  });

  it('reports drifted files when on-disk content differs', () => {
    installSubagents({ targetDir: tmpDir });
    const baFile = join(tmpDir, 'caia-ba.md');
    writeFileSync(baFile, '---\nname: caia-ba\ndescription: tampered\n---\n', 'utf-8');
    const result = verifyInstalled({ targetDir: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.driftedCount).toBe(1);
    expect(result.presentCount).toBe(MANIFEST.entries.length - 1);
    const ba = result.results.find((r) => r.name === 'caia-ba');
    expect(ba?.status).toBe('present-drifted');
    expect(ba?.onDiskSha).toBeDefined();
    expect(ba?.shippedSha).toBeDefined();
    expect(ba?.onDiskSha).not.toBe(ba?.shippedSha);
  });

  it('honours `only` for partial-set verification', () => {
    installSubagents({ targetDir: tmpDir, only: ['caia-coding'] });
    const result = verifyInstalled({ targetDir: tmpDir, only: ['caia-coding'] });
    expect(result.ok).toBe(true);
    expect(result.presentCount).toBe(1);
  });
});
