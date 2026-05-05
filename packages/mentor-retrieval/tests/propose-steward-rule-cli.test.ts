/**
 * Tests for caia-mentor-propose-steward-rule (Phase-4 PR-2 CLI).
 */

import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main, parseArgs } from '../src/propose-steward-rule-cli.js';
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
  env: NodeJS.ProcessEnv = {}
): Promise<CapturedIo> {
  const cap = captureRun();
  try {
    await main({
      argv,
      env,
      stdout: cap.stdout,
      stderr: cap.stderr,
      exit: cap.exit
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

describe('parseArgs', () => {
  it('defaults to threshold=3 / json / no force / no include-bursts', () => {
    const p = parseArgs(['list'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.subcommand).toBe('list');
    expect(p.threshold).toBe(3);
    expect(p.format).toBe('json');
    expect(p.force).toBe(false);
    expect(p.includeBursts).toBe(false);
  });
  it('reads write subcommand', () => {
    const p = parseArgs(['write'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.subcommand).toBe('write');
  });
  it('reads --force', () => {
    const p = parseArgs(['write', '--force'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.force).toBe(true);
  });
  it('reads --include-bursts', () => {
    const p = parseArgs(['list', '--include-bursts'], {
      CAIA_MEMORY_DIR: '/m'
    });
    expect(p.includeBursts).toBe(true);
  });
  it('throws on unknown subcommand', () => {
    expect(() => parseArgs(['frobnicate'], {})).toThrow(/unknown subcommand/);
  });
  it('throws on bad threshold', () => {
    expect(() => parseArgs(['list', '--threshold', 'abc'], {})).toThrow(
      /positive integer/
    );
  });
  it('throws on missing subcommand', () => {
    expect(() => parseArgs([], {})).toThrow(/subcommand/);
  });
  it('throws on bad format', () => {
    expect(() => parseArgs(['list', '--format', 'csv'], {})).toThrow(
      /text\|json/
    );
  });
});

describe('main list', () => {
  let memoryDir: string;
  beforeEach(() => {
    memoryDir = mkdtempSync(join(tmpdir(), 'mentor-rule-cli-'));
  });
  afterEach(() => {
    /* tmpdir auto-cleaned */
  });

  it('returns empty proposals when no systemic clusters exist', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-relitigation-foo');
    seedProposal(store, '20260505-100100-decisionclassifierviolation-bar');
    store.close();

    const io = await runMain(['list', '--memory', memoryDir]);
    expect(io.exitCode).toBe(0);
    const out = JSON.parse(io.stdout.join('\n')) as {
      count: number;
      proposals: unknown[];
    };
    expect(out.count).toBe(0);
  });

  it('skips burst clusters by default', async () => {
    // A burst cluster: 4 events all within 60s.
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-prematurecompletion-burst-x');
    seedProposal(store, '20260505-100010-prematurecompletion-burst-x-2');
    seedProposal(store, '20260505-100020-prematurecompletion-burst-x-3');
    seedProposal(store, '20260505-100030-prematurecompletion-burst-x-4');
    store.close();

    const io = await runMain(['list', '--memory', memoryDir]);
    expect(io.exitCode).toBe(0);
    const out = JSON.parse(io.stdout.join('\n')) as { count: number };
    expect(out.count).toBe(0);
  });

  it('--include-bursts exposes burst clusters', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-prematurecompletion-burst-x');
    seedProposal(store, '20260505-100010-prematurecompletion-burst-x-2');
    seedProposal(store, '20260505-100020-prematurecompletion-burst-x-3');
    store.close();

    const io = await runMain([
      'list',
      '--memory',
      memoryDir,
      '--include-bursts'
    ]);
    expect(io.exitCode).toBe(0);
    const out = JSON.parse(io.stdout.join('\n')) as { count: number };
    expect(out.count).toBe(1);
  });

  it('emits markdown when --format text', async () => {
    const store = openIndexStore({ memoryDir });
    // Sustained (non-burst) cluster — events span >1h.
    seedProposal(store, '20260505-100000-prematurecompletion-sustained-x');
    seedProposal(store, '20260505-130000-prematurecompletion-sustained-x-2');
    seedProposal(store, '20260506-100000-prematurecompletion-sustained-x-3');
    store.close();

    const io = await runMain([
      'list',
      '--memory',
      memoryDir,
      '--format',
      'text'
    ]);
    expect(io.exitCode).toBe(0);
    const out = io.stdout.join('\n');
    expect(out).toMatch(/type: steward-rule-proposal/);
    expect(out).toMatch(/sustained-x/);
  });

  it('exits 2 if no index DB present', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'mentor-rule-cli-empty-'));
    const io = await runMain(['list', '--memory', empty]);
    expect(io.exitCode).toBe(2);
    expect(io.stderr.join('\n')).toMatch(/no index DB/);
  });

  it('help exits 0', async () => {
    const io = await runMain(['help']);
    expect(io.exitCode).toBe(0);
    expect(io.stdout.join('\n')).toMatch(/caia-mentor-propose-steward-rule/);
  });
});

describe('main write', () => {
  let memoryDir: string;
  beforeEach(() => {
    memoryDir = mkdtempSync(join(tmpdir(), 'mentor-rule-cli-write-'));
  });
  afterEach(() => {
    /* tmpdir auto-cleaned */
  });

  it('writes proposal files for sustained systemic clusters', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-prematurecompletion-sustained-x');
    seedProposal(store, '20260505-130000-prematurecompletion-sustained-x-2');
    seedProposal(store, '20260506-100000-prematurecompletion-sustained-x-3');
    store.close();

    const io = await runMain(['write', '--memory', memoryDir]);
    expect(io.exitCode).toBe(0);
    const out = JSON.parse(io.stdout.join('\n')) as {
      writtenCount: number;
      skippedCount: number;
      proposalsDir: string;
    };
    expect(out.writtenCount).toBe(1);
    expect(out.skippedCount).toBe(0);
    expect(
      existsSync(
        join(out.proposalsDir, 'steward-rule-prematurecompletion-sustained-x.md')
      )
    ).toBe(true);
  });

  it('preserves existing files when --force is not passed', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-prematurecompletion-sustained-x');
    seedProposal(store, '20260505-130000-prematurecompletion-sustained-x-2');
    seedProposal(store, '20260506-100000-prematurecompletion-sustained-x-3');
    store.close();

    const io1 = await runMain(['write', '--memory', memoryDir]);
    expect(io1.exitCode).toBe(0);
    const io2 = await runMain(['write', '--memory', memoryDir]);
    const out2 = JSON.parse(io2.stdout.join('\n')) as {
      writtenCount: number;
      skippedCount: number;
    };
    expect(out2.writtenCount).toBe(0);
    expect(out2.skippedCount).toBe(1);
  });

  it('overwrites with --force', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-prematurecompletion-sustained-x');
    seedProposal(store, '20260505-130000-prematurecompletion-sustained-x-2');
    seedProposal(store, '20260506-100000-prematurecompletion-sustained-x-3');
    store.close();

    await runMain(['write', '--memory', memoryDir]);
    const io = await runMain(['write', '--memory', memoryDir, '--force']);
    const out = JSON.parse(io.stdout.join('\n')) as {
      writtenCount: number;
      skippedCount: number;
    };
    expect(out.writtenCount).toBe(1);
    expect(out.skippedCount).toBe(0);
  });

  it('exits 2 when no index DB', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'mentor-rule-cli-write-empty-'));
    const io = await runMain(['write', '--memory', empty]);
    expect(io.exitCode).toBe(2);
  });
});
