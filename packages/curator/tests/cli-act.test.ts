/**
 * CLI tests for the Phase-2 PR-3 subcommands:
 *
 *   - emit-industry-briefings
 *   - act (unified runner)
 *
 * Same tmpdir + JSON-shape assertions as the other emit-* tests.
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

function lastJsonLine<T = unknown>(): T {
  const out = logSpy.mock.calls.map((c) => c[0]).join('\n');
  const lines = out.split('\n').filter((l) => l.startsWith('{'));
  return JSON.parse(lines[lines.length - 1]!) as T;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'curator-cli-act-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
});

describe('cli main() emit-industry-briefings', () => {
  it('emits one .md per watchlist entry', async () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'MEMORY.md'), '');
    writeFileSync(
      join(memDir, 'curator-watchlist.json'),
      JSON.stringify({
        entries: [
          { topic: 'one', title: 'One', summary: 'about one' },
          { topic: 'two', title: 'Two', summary: 'about two' }
        ]
      })
    );
    const outDir = join(tmp, 'briefings');

    await main([
      'emit-industry-briefings',
      '--repo',
      tmp,
      '--memory',
      memDir,
      '--out-dir',
      outDir
    ]);

    const json = lastJsonLine<{
      ok: boolean;
      kind: string;
      writtenCount: number;
      matchingActions: number;
      totalFindings: number;
    }>();
    expect(json.ok).toBe(true);
    expect(json.kind).toBe('industry-briefing');
    expect(json.writtenCount).toBe(2);
    expect(json.matchingActions).toBe(2);
    expect(json.totalFindings).toBe(0);
    expect(existsSync(join(outDir, 'industry-briefing-one.md'))).toBe(true);
    expect(existsSync(join(outDir, 'industry-briefing-two.md'))).toBe(true);
  });

  it('returns 0 written when no watchlist file exists', async () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'MEMORY.md'), '');
    const outDir = join(tmp, 'no-watchlist');

    await main([
      'emit-industry-briefings',
      '--repo',
      tmp,
      '--memory',
      memDir,
      '--out-dir',
      outDir
    ]);

    const json = lastJsonLine<{ writtenCount: number; matchingActions: number }>();
    expect(json.writtenCount).toBe(0);
    expect(json.matchingActions).toBe(0);
  });

  it('explicit --watchlist overrides memoryDir lookup', async () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'MEMORY.md'), '');
    const customPath = join(tmp, 'custom.json');
    writeFileSync(
      customPath,
      JSON.stringify({ entries: [{ topic: 'custom' }] })
    );
    const outDir = join(tmp, 'custom-out');

    await main([
      'emit-industry-briefings',
      '--repo',
      tmp,
      '--memory',
      memDir,
      '--watchlist',
      customPath,
      '--out-dir',
      outDir
    ]);
    const json = lastJsonLine<{ writtenCount: number }>();
    expect(json.writtenCount).toBe(1);
  });
});

describe('cli main() act', () => {
  it('runs all 4 emitters + returns combined summary JSON', async () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'MEMORY.md'), '');
    writeFileSync(
      join(memDir, 'curator-watchlist.json'),
      JSON.stringify({ entries: [{ topic: 'sample' }] })
    );
    const reports = join(tmp, 'reports');

    await main([
      'act',
      '--repo',
      tmp,
      '--memory',
      memDir,
      '--reports',
      reports
    ]);

    const json = lastJsonLine<{
      ok: boolean;
      findingCount: number;
      classifiedCount: number;
      watchlistCount: number;
      emit: {
        alarms: { outputDir: string; writtenCount: number };
        prProposals: { outputDir: string; writtenCount: number };
        backlogDirectives: { outputDir: string; writtenCount: number };
        industryBriefings: { outputDir: string; writtenCount: number };
      };
    }>();

    expect(json.ok).toBe(true);
    expect(json.watchlistCount).toBe(1);
    expect(json.emit.industryBriefings.writtenCount).toBe(1);
    expect(json.emit.alarms.outputDir).toBe(join(reports, 'curator', 'alarms'));
    expect(json.emit.prProposals.outputDir).toBe(
      join(reports, 'curator', 'pr-proposals')
    );
    expect(json.emit.backlogDirectives.outputDir).toBe(
      join(reports, 'curator', 'backlog-directives')
    );
    expect(json.emit.industryBriefings.outputDir).toBe(
      join(reports, 'curator', 'industry-briefings')
    );
  });

  it('--skip-watchlist skips industry briefings', async () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'MEMORY.md'), '');
    writeFileSync(
      join(memDir, 'curator-watchlist.json'),
      JSON.stringify({ entries: [{ topic: 'should-not-emit' }] })
    );
    const reports = join(tmp, 'reports-skip');

    await main([
      'act',
      '--repo',
      tmp,
      '--memory',
      memDir,
      '--reports',
      reports,
      '--skip-watchlist'
    ]);

    const json = lastJsonLine<{
      watchlistCount: number;
      emit: { industryBriefings: { writtenCount: number } };
    }>();
    expect(json.watchlistCount).toBe(0);
    expect(json.emit.industryBriefings.writtenCount).toBe(0);
  });

  it('respects all 4 explicit out-dir flags', async () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'MEMORY.md'), '');

    await main([
      'act',
      '--repo',
      tmp,
      '--memory',
      memDir,
      '--alarms-dir',
      join(tmp, 'a'),
      '--pr-proposals-dir',
      join(tmp, 'p'),
      '--backlog-directives-dir',
      join(tmp, 'b'),
      '--industry-briefings-dir',
      join(tmp, 'i'),
      '--skip-watchlist'
    ]);

    const json = lastJsonLine<{
      emit: {
        alarms: { outputDir: string };
        prProposals: { outputDir: string };
        backlogDirectives: { outputDir: string };
        industryBriefings: { outputDir: string };
      };
    }>();
    expect(json.emit.alarms.outputDir).toBe(join(tmp, 'a'));
    expect(json.emit.prProposals.outputDir).toBe(join(tmp, 'p'));
    expect(json.emit.backlogDirectives.outputDir).toBe(join(tmp, 'b'));
    expect(json.emit.industryBriefings.outputDir).toBe(join(tmp, 'i'));
  });

  it('usage line lists act + emit-industry-briefings', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`exit ${code}`);
      }) as never);
    try {
      await expect(main(['--help'])).rejects.toThrow(/exit 2/);
      const errOut = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(errOut).toContain('emit-industry-briefings');
      expect(errOut).toContain(' act ');
    } finally {
      exitSpy.mockRestore();
    }
  });
});
