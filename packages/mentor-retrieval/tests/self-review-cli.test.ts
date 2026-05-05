/**
 * Tests for caia-mentor-self-review (Phase-4 PR-3 CLI).
 */

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main, parseArgs } from '../src/self-review-cli.js';
import { vectorToBlob } from '../src/embed.js';
import { openIndexStore } from '../src/index-store.js';
import type { IndexedLesson } from '../src/types.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

class ExitSignal extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

function captureRun(): {
  io: CapturedIo;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  exit: (code: number) => never;
} {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  return {
    io,
    stdout: (s: string) => io.stdout.push(s),
    stderr: (s: string) => io.stderr.push(s),
    exit: ((code: number): never => {
      io.exitCode = code;
      throw new ExitSignal(code);
    }) as (code: number) => never
  };
}

async function runMain(
  argv: string[],
  env: NodeJS.ProcessEnv = {},
  nowMs?: number
): Promise<CapturedIo> {
  const cap = captureRun();
  try {
    await main({
      argv,
      env,
      stdout: cap.stdout,
      stderr: cap.stderr,
      exit: cap.exit,
      ...(nowMs !== undefined ? { nowMs } : {})
    });
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e;
  }
  return cap.io;
}

function seedProposal(
  store: ReturnType<typeof openIndexStore>,
  slug: string
): void {
  const lesson: Omit<IndexedLesson, 'id'> = {
    sourcePath: `/fake/${slug}.md`,
    kind: 'proposal',
    slug,
    mtimeMs: 0,
    contentSha256: 'x',
    contentSnippet: '',
    embeddingDim: 1,
    embedding: vectorToBlob(new Float32Array([1])),
    indexedAtMs: 0
  };
  store.upsertLesson(lesson);
}

const NOW_MS = Date.UTC(2026, 4, 5, 18, 0, 0);

describe('parseArgs', () => {
  it('defaults to windowDays=90, topN=10, format=md, no output', () => {
    const p = parseArgs(['run'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.subcommand).toBe('run');
    expect(p.windowDays).toBe(90);
    expect(p.topN).toBe(10);
    expect(p.format).toBe('md');
    expect(p.outputPath).toBeNull();
  });
  it('reads --window-days', () => {
    const p = parseArgs(['run', '--window-days', '7'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.windowDays).toBe(7);
  });
  it('reads --top-n', () => {
    const p = parseArgs(['run', '--top-n', '5'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.topN).toBe(5);
  });
  it('reads --output', () => {
    const p = parseArgs(['run', '--output', '/tmp/r.md'], {
      CAIA_MEMORY_DIR: '/m'
    });
    expect(p.outputPath).toBe('/tmp/r.md');
  });
  it('reads --format json', () => {
    const p = parseArgs(['run', '--format', 'json'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.format).toBe('json');
  });
  it('throws on unknown subcommand', () => {
    expect(() => parseArgs(['frobnicate'], {})).toThrow(/unknown subcommand/);
  });
  it('throws on missing subcommand', () => {
    expect(() => parseArgs([], {})).toThrow(/subcommand/);
  });
  it('throws on bad windowDays', () => {
    expect(() => parseArgs(['run', '--window-days', '0'], {})).toThrow(
      /positive integer/
    );
    expect(() => parseArgs(['run', '--window-days', 'abc'], {})).toThrow(
      /positive integer/
    );
  });
  it('throws on bad topN', () => {
    expect(() => parseArgs(['run', '--top-n', '-1'], {})).toThrow(
      /positive integer/
    );
  });
  it('throws on bad format', () => {
    expect(() => parseArgs(['run', '--format', 'csv'], {})).toThrow(/md\|json/);
  });
  it('throws on unknown flag', () => {
    expect(() => parseArgs(['run', '--bogus'], {})).toThrow(/unknown flag/);
  });
});

describe('main run', () => {
  let memoryDir: string;
  beforeEach(() => {
    memoryDir = mkdtempSync(join(tmpdir(), 'mentor-self-cli-'));
  });
  afterEach(() => {
    /* tmpdir auto-cleaned */
  });

  it('emits markdown on stdout by default', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-relitigation-foo');
    seedProposal(store, '20260505-100100-relitigation-foo-2');
    seedProposal(store, '20260505-100200-relitigation-foo-3');
    store.close();

    const io = await runMain(['run', '--memory', memoryDir], {}, NOW_MS);
    expect(io.exitCode).toBe(0);
    const out = io.stdout.join('\n');
    expect(out).toMatch(/^# Mentor self-review/);
    expect(out).toMatch(/relitigation\/foo/);
  });

  it('emits JSON when --format json', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-relitigation-foo');
    store.close();

    const io = await runMain(
      ['run', '--memory', memoryDir, '--format', 'json'],
      {},
      NOW_MS
    );
    expect(io.exitCode).toBe(0);
    const obj = JSON.parse(io.stdout.join('\n')) as { totalLessons: number };
    expect(obj.totalLessons).toBe(1);
  });

  it('writes report to --output path', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-relitigation-foo');
    store.close();

    const outPath = join(memoryDir, 'review.md');
    const io = await runMain(
      ['run', '--memory', memoryDir, '--output', outPath],
      {},
      NOW_MS
    );
    expect(io.exitCode).toBe(0);
    expect(io.stdout.join('\n')).toMatch(/wrote /);
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, 'utf-8')).toMatch(/^# Mentor self-review/);
  });

  it('respects --window-days', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-relitigation-recent');
    seedProposal(store, '20251201-100000-relitigation-old');
    store.close();

    const io = await runMain(
      ['run', '--memory', memoryDir, '--window-days', '30', '--format', 'json'],
      {},
      NOW_MS
    );
    const obj = JSON.parse(io.stdout.join('\n')) as {
      proposalsWithinWindow: number;
    };
    expect(obj.proposalsWithinWindow).toBe(1);
  });

  it('exits 2 if no index DB present', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'mentor-self-cli-empty-'));
    const io = await runMain(['run', '--memory', empty]);
    expect(io.exitCode).toBe(2);
    expect(io.stderr.join('\n')).toMatch(/no index DB/);
  });

  it('help exits 0 with usage', async () => {
    const io = await runMain(['help']);
    expect(io.exitCode).toBe(0);
    expect(io.stdout.join('\n')).toMatch(/caia-mentor-self-review/);
  });

  it('detects existing steward-rule proposals via FS scanner', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-relitigation-foo');
    seedProposal(store, '20260505-100100-relitigation-foo-2');
    seedProposal(store, '20260505-100200-relitigation-foo-3');
    store.close();

    // Pre-write a steward-rule proposal file
    const proposalsDir = join(memoryDir, 'proposals');
    // proposals dir already exists since we seeded; double-check
    if (!existsSync(proposalsDir)) {
      // openIndexStore doesn't make proposals dir; create it
      await import('node:fs/promises').then((fs) =>
        fs.mkdir(proposalsDir, { recursive: true })
      );
    }
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(
        join(proposalsDir, 'steward-rule-relitigation-foo.md'),
        '# proposal\n'
      )
    );

    const io = await runMain(
      ['run', '--memory', memoryDir, '--format', 'json'],
      {},
      NOW_MS
    );
    const obj = JSON.parse(io.stdout.join('\n')) as {
      systemicClustersWithRuleProposal: number;
      stewardRuleProposalsOnDisk: number;
    };
    expect(obj.stewardRuleProposalsOnDisk).toBe(1);
    expect(obj.systemicClustersWithRuleProposal).toBe(1);
  });
});

describe('main run — error path', () => {
  it('exits 2 if --output path is unwritable', async () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'mentor-self-cli-err-'));
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-relitigation-foo');
    store.close();

    const io = await runMain(
      [
        'run',
        '--memory',
        memoryDir,
        '--output',
        '/dev/no-such-path/out.md'
      ],
      {},
      NOW_MS
    );
    expect(io.exitCode).toBe(2);
    expect(io.stderr.join('\n')).toMatch(/failed to write report/);
  });
});
