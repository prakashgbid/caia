/**
 * CLI dispatcher tests — exercise main(argv) in-process.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../src/cli.js';

let tmp: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'curator-cli-test-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
});

describe('cli main()', () => {
  it('list-scanners prints one JSON line per scanner', async () => {
    await main(['list-scanners']);
    const out = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(out).toContain('"id":"worktree-count"');
    expect(out).toContain('"id":"open-pr-age"');
    expect(out).toContain('"id":"memory-drift"');
    expect(out).toContain('"id":"stale-todos"');
    expect(out).toContain('"id":"dependabot-cves"');
  });

  it('--help exits with code 2 and prints usage', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);
    try {
      await expect(main(['--help'])).rejects.toThrow(/exit 2/);
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('Usage'))).toBe(true);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('unknown subcommand prints error + exits 2', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);
    try {
      await expect(main(['mystery'])).rejects.toThrow(/exit 2/);
      expect(
        errSpy.mock.calls.some((c) => String(c[0]).includes('unknown subcommand'))
      ).toBe(true);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('run-one with unknown scanner exits 2', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);
    try {
      await expect(main(['run-one', 'nope'])).rejects.toThrow(/exit 2/);
      expect(
        errSpy.mock.calls.some((c) => String(c[0]).includes('unknown scanner'))
      ).toBe(true);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('run-one without scanner id exits 2', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);
    try {
      await expect(main(['run-one'])).rejects.toThrow(/exit 2/);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('daily writes a digest to the --out path', async () => {
    // Setup minimal memory dir so memory-drift doesn't error out.
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'a.md'), '');
    writeFileSync(join(memDir, 'MEMORY.md'), '- [a](a.md)\n');
    const reportsDir = join(tmp, 'reports');
    const outPath = join(tmp, 'digest.md');

    // Several scanners shell out (gh, grep, git-worktree); against a
    // non-git tmp dir they will gracefully degrade to "could not query"
    // findings. The CLI should still produce a digest.
    await main([
      'daily',
      '--repo',
      tmp,
      '--memory',
      memDir,
      '--reports',
      reportsDir,
      '--out',
      outPath
    ]);

    expect(existsSync(outPath)).toBe(true);
    const md = readFileSync(outPath, 'utf-8');
    expect(md).toContain('# Curator Digest');
    expect(md).toContain('## Top');
    expect(md).toContain('## Scanner run summary');

    const out = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(out).toContain('"ok":true');
    expect(out).toContain('"digest"');
    expect(out).toContain('"scanners":5');
  });
});
