import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { MANIFEST } from '../src/manifest.js';

let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'caia-claude-subagents-cli-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as never);
});

describe('cli install', () => {
  it('writes every shipped subagent into the target dir', () => {
    main(['install', '--target', tmpDir]);
    for (const e of MANIFEST.entries) {
      expect(existsSync(join(tmpDir, e.filename))).toBe(true);
    }
    expect(logSpy).toHaveBeenCalled();
    const arg = logSpy.mock.calls[0]?.[0] as string;
    const json = JSON.parse(arg);
    expect(json.ok).toBe(true);
    expect(json.writtenCount).toBe(MANIFEST.entries.length);
    expect(json.targetDir).toBe(tmpDir);
  });

  it('honours --only for a single-name install', () => {
    main(['install', '--target', tmpDir, '--only', 'caia-coding']);
    expect(existsSync(join(tmpDir, 'caia-coding.md'))).toBe(true);
    expect(existsSync(join(tmpDir, 'caia-ba.md'))).toBe(false);
  });

  it('honours --force', () => {
    main(['install', '--target', tmpDir]);
    logSpy.mockClear();
    main(['install', '--target', tmpDir, '--force']);
    const arg = logSpy.mock.calls[0]?.[0] as string;
    const json = JSON.parse(arg);
    expect(json.overwrittenCount).toBe(MANIFEST.entries.length);
    expect(json.skippedCount).toBe(0);
  });
});

describe('cli verify', () => {
  it('exits 0 when every file is installed + matches', () => {
    main(['install', '--target', tmpDir]);
    logSpy.mockClear();
    expect(() => main(['verify', '--target', tmpDir])).not.toThrow();
    const arg = logSpy.mock.calls[0]?.[0] as string;
    const json = JSON.parse(arg);
    expect(json.ok).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits non-zero when files are missing', () => {
    expect(() => main(['verify', '--target', tmpDir])).toThrow(/process.exit:2/);
  });
});

describe('cli list', () => {
  it('prints one JSON line per manifest entry', () => {
    main(['list']);
    expect(logSpy.mock.calls.length).toBe(MANIFEST.entries.length);
    for (const call of logSpy.mock.calls) {
      const json = JSON.parse(call[0] as string);
      expect(json.name).toMatch(/^caia-/);
      expect(json.tier).toBeGreaterThanOrEqual(2);
      expect(json.tools.length).toBeGreaterThan(0);
    }
  });
});

describe('cli show', () => {
  it('prints the .md content for a known subagent', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    main(['show', 'caia-coding']);
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    expect(written).toContain('name: caia-coding');
    expect(written).toContain('CAIA Coding Worker');
    stdoutSpy.mockRestore();
  });

  it('exits non-zero for an unknown subagent', () => {
    expect(() => main(['show', 'caia-bogus'])).toThrow(/process.exit:2/);
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('cli usage', () => {
  it('exits non-zero with no subcommand', () => {
    expect(() => main([])).toThrow(/process.exit:2/);
  });

  it('exits non-zero on unknown subcommand', () => {
    expect(() => main(['bogus-subcommand'])).toThrow(/process.exit:2/);
  });
});
