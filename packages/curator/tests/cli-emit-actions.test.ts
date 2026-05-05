/**
 * CLI tests for the Phase-2 PR-2 subcommands:
 *
 *   - emit-pr-proposals
 *   - emit-backlog-directives
 *
 * Same pattern as `cli-emit-alarms.test.ts` — verify wiring + JSON
 * output shape against a tmpdir-rooted ScanContext. Real scanners
 * run; we don't assert specific counts.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../src/cli.js';

let tmp: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

function lastJsonLine(): {
  ok: boolean;
  kind: string;
  outputDir: string;
  writtenCount: number;
  skippedCount: number;
  matchingActions: number;
  totalActions: number;
  totalFindings: number;
  written: unknown[];
  skipped: unknown[];
} {
  const out = logSpy.mock.calls.map((c) => c[0]).join('\n');
  const lines = out.split('\n').filter((l) => l.startsWith('{'));
  const last = lines[lines.length - 1]!;
  return JSON.parse(last);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'curator-cli-emit-actions-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
});

describe('cli main() emit-pr-proposals', () => {
  it('produces ok:true JSON with kind: pr-proposal', async () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'MEMORY.md'), '');
    const outDir = join(tmp, 'pr-proposals');

    await main([
      'emit-pr-proposals',
      '--repo',
      tmp,
      '--memory',
      memDir,
      '--out-dir',
      outDir
    ]);

    const json = lastJsonLine();
    expect(json.ok).toBe(true);
    expect(json.kind).toBe('pr-proposal');
    expect(json.outputDir).toBe(outDir);
    expect(json.writtenCount + json.skippedCount).toBe(json.matchingActions);
    expect(json.matchingActions).toBeLessThanOrEqual(json.totalActions);
    expect(json.totalActions).toBeLessThanOrEqual(json.totalFindings);
    expect(existsSync(outDir)).toBe(true);
  });

  it('uses defaultPrProposalsDir under reports when --out-dir omitted', async () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'MEMORY.md'), '');
    const reports = join(tmp, 'reports');

    await main([
      'emit-pr-proposals',
      '--repo',
      tmp,
      '--memory',
      memDir,
      '--reports',
      reports
    ]);
    const json = lastJsonLine();
    expect(json.outputDir).toBe(join(reports, 'curator', 'pr-proposals'));
  });

  it('--force flag is parsed cleanly', async () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'MEMORY.md'), '');
    const outDir = join(tmp, 'pr-force');
    await main([
      'emit-pr-proposals',
      '--repo',
      tmp,
      '--memory',
      memDir,
      '--out-dir',
      outDir,
      '--force'
    ]);
    const json = lastJsonLine();
    expect(json.ok).toBe(true);
  });
});

describe('cli main() emit-backlog-directives', () => {
  it('produces ok:true JSON with kind: backlog-directive', async () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'MEMORY.md'), '');
    const outDir = join(tmp, 'directives');

    await main([
      'emit-backlog-directives',
      '--repo',
      tmp,
      '--memory',
      memDir,
      '--out-dir',
      outDir
    ]);

    const json = lastJsonLine();
    expect(json.ok).toBe(true);
    expect(json.kind).toBe('backlog-directive');
    expect(json.outputDir).toBe(outDir);
    expect(json.writtenCount + json.skippedCount).toBe(json.matchingActions);
  });

  it('uses defaultBacklogDirectivesDir when --out-dir omitted', async () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'MEMORY.md'), '');
    const reports = join(tmp, 'reports');

    await main([
      'emit-backlog-directives',
      '--repo',
      tmp,
      '--memory',
      memDir,
      '--reports',
      reports
    ]);
    const json = lastJsonLine();
    expect(json.outputDir).toBe(
      join(reports, 'curator', 'backlog-directives')
    );
  });

  it('usage line lists the two new subcommands', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`exit ${code}`);
      }) as never);
    try {
      await expect(main(['--help'])).rejects.toThrow(/exit 2/);
      const errOut = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(errOut).toContain('emit-pr-proposals');
      expect(errOut).toContain('emit-backlog-directives');
    } finally {
      exitSpy.mockRestore();
    }
  });
});
