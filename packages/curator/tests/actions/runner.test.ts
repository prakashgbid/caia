/**
 * Tests for the Curator Phase-2 unified `runActDay` runner.
 *
 * The runner is the workhorse — it stitches together the scan loop,
 * the classifier, the watchlist, and all 4 emitters. Because the
 * scanners shell out (gh, git, grep), we run against a tmpdir
 * memoryDir + a custom ScanContext with mocked runShell.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runActDay } from '../../src/actions/runner.js';
import type { ScanContext } from '../../src/types.js';

let tmp: string;

function buildCtx(): ScanContext {
  return {
    repoRoot: tmp,
    memoryDir: join(tmp, 'memory'),
    reportsDir: join(tmp, 'reports'),
    runShell: vi.fn().mockImplementation((cmd: string, args: string[]): string => {
      // Make every shell-call return a clean baseline:
      //   - git worktree list        -> just main
      //   - gh ... dependabot/alerts -> []
      //   - grep ...                 -> empty
      //   - gh pr list               -> []
      const argStr = args.join(' ');
      if (cmd === 'git' && argStr.includes('worktree list')) {
        return 'worktree /main\nbranch refs/heads/develop\n';
      }
      if (cmd === 'gh' && argStr.includes('dependabot/alerts')) {
        return '[]';
      }
      if (cmd === 'gh' && argStr.includes('pr list')) {
        return '[]';
      }
      return '';
    }),
    env: {},
    now: () => new Date('2026-05-05T22:50:00.000Z')
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'curator-runner-'));
  // Create empty memoryDir so memory-drift scanner doesn't error.
  const memDir = join(tmp, 'memory');
  mkdirSync(memDir, { recursive: true });
  writeFileSync(join(memDir, 'MEMORY.md'), '');
});

describe('runActDay', () => {
  it('runs the full pipeline + returns aggregated counts', async () => {
    const ctx = buildCtx();
    const r = await runActDay(ctx);
    expect(typeof r.findingCount).toBe('number');
    expect(typeof r.classifiedCount).toBe('number');
    expect(typeof r.watchlistCount).toBe('number');
    expect(r.classifiedCount).toBeLessThanOrEqual(r.findingCount);
    expect(r.watchlistCount).toBe(0); // no watchlist file yet
    expect(typeof r.startedAt).toBe('string');
    expect(typeof r.endedAt).toBe('string');
  });

  it('emits per-kind EmitResults with correct outputDirs', async () => {
    const ctx = buildCtx();
    const r = await runActDay(ctx);
    const reportsDir = ctx.reportsDir;
    expect(r.emit.alarms.outputDir).toBe(join(reportsDir, 'curator', 'alarms'));
    expect(r.emit.prProposals.outputDir).toBe(
      join(reportsDir, 'curator', 'pr-proposals')
    );
    expect(r.emit.backlogDirectives.outputDir).toBe(
      join(reportsDir, 'curator', 'backlog-directives')
    );
    expect(r.emit.industryBriefings.outputDir).toBe(
      join(reportsDir, 'curator', 'industry-briefings')
    );
  });

  it('loads watchlist when file exists + emits one briefing per entry', async () => {
    const ctx = buildCtx();
    const watchlistPath = join(ctx.memoryDir, 'curator-watchlist.json');
    writeFileSync(
      watchlistPath,
      JSON.stringify({
        version: 1,
        entries: [
          { topic: 'one', title: 'Topic one', summary: 'about one' },
          { topic: 'two', title: 'Topic two', summary: 'about two' }
        ]
      })
    );
    const r = await runActDay(ctx);
    expect(r.watchlistCount).toBe(2);
    expect(r.emit.industryBriefings.writtenCount).toBe(2);
    expect(
      existsSync(
        join(
          ctx.reportsDir,
          'curator',
          'industry-briefings',
          'industry-briefing-one.md'
        )
      )
    ).toBe(true);
  });

  it('skipIndustryBriefings: true → watchlistCount 0 even with file', async () => {
    const ctx = buildCtx();
    const watchlistPath = join(ctx.memoryDir, 'curator-watchlist.json');
    writeFileSync(
      watchlistPath,
      JSON.stringify({ entries: [{ topic: 'should-be-skipped' }] })
    );
    const r = await runActDay(ctx, { skipIndustryBriefings: true });
    expect(r.watchlistCount).toBe(0);
    expect(r.emit.industryBriefings.writtenCount).toBe(0);
  });

  it('explicit watchlistPath overrides memoryDir lookup', async () => {
    const ctx = buildCtx();
    const customPath = join(tmp, 'custom-watchlist.json');
    writeFileSync(
      customPath,
      JSON.stringify({ entries: [{ topic: 'custom' }] })
    );
    const r = await runActDay(ctx, { watchlistPath: customPath });
    expect(r.watchlistCount).toBe(1);
  });

  it('respects override outDirs across all 4 emitters', async () => {
    const ctx = buildCtx();
    const r = await runActDay(ctx, {
      alarmsDir: join(tmp, 'a'),
      prProposalsDir: join(tmp, 'p'),
      backlogDirectivesDir: join(tmp, 'b'),
      industryBriefingsDir: join(tmp, 'i')
    });
    expect(r.emit.alarms.outputDir).toBe(join(tmp, 'a'));
    expect(r.emit.prProposals.outputDir).toBe(join(tmp, 'p'));
    expect(r.emit.backlogDirectives.outputDir).toBe(join(tmp, 'b'));
    expect(r.emit.industryBriefings.outputDir).toBe(join(tmp, 'i'));
  });

  it('is idempotent — second run skips already-written files', async () => {
    const ctx = buildCtx();
    const watchlistPath = join(ctx.memoryDir, 'curator-watchlist.json');
    writeFileSync(
      watchlistPath,
      JSON.stringify({ entries: [{ topic: 'idem' }] })
    );
    const r1 = await runActDay(ctx);
    const r2 = await runActDay(ctx);
    expect(r1.emit.industryBriefings.writtenCount).toBe(1);
    expect(r2.emit.industryBriefings.writtenCount).toBe(0);
    expect(r2.emit.industryBriefings.skippedCount).toBe(1);
  });

  it('force: true overwrites already-written files', async () => {
    const ctx = buildCtx();
    const watchlistPath = join(ctx.memoryDir, 'curator-watchlist.json');
    writeFileSync(
      watchlistPath,
      JSON.stringify({ entries: [{ topic: 'force-test' }] })
    );
    await runActDay(ctx);
    // Operator-edits the file.
    const briefingPath = join(
      ctx.reportsDir,
      'curator',
      'industry-briefings',
      'industry-briefing-force-test.md'
    );
    writeFileSync(briefingPath, 'STALE\n');
    const r2 = await runActDay(ctx, { force: true });
    expect(r2.emit.industryBriefings.writtenCount).toBe(1);
    expect(readFileSync(briefingPath, 'utf-8')).not.toBe('STALE\n');
  });
});
