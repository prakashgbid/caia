/**
 * Tests for caia-mentor-cluster (Phase-4 PR-1 CLI).
 *
 * These tests exercise:
 *   - argv parsing (subcommand + flag handling + validation)
 *   - the `list` subcommand against a real (temp) index DB populated
 *     with proposal rows
 *   - graceful failure when the index DB doesn't exist yet
 */

import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main, parseArgs } from '../src/cluster-cli.js';
import { openIndexStore } from '../src/index-store.js';
import { vectorToBlob } from '../src/embed.js';
import type { IndexedLesson } from '../src/types.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
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
      // Throw to short-circuit `main`'s control flow without actually
      // exiting the test runner.
      throw new ExitSignal(code);
    }) as (code: number) => never
  };
}

class ExitSignal extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
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
  it('defaults to threshold=3, json, no --all', () => {
    const p = parseArgs(['list'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.subcommand).toBe('list');
    expect(p.threshold).toBe(3);
    expect(p.format).toBe('json');
    expect(p.all).toBe(false);
    expect(p.memoryDir).toBe('/m');
  });
  it('reads --threshold', () => {
    const p = parseArgs(['list', '--threshold', '5'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.threshold).toBe(5);
  });
  it('reads --burst-ms', () => {
    const p = parseArgs(['list', '--burst-ms', '7200000'], {
      CAIA_MEMORY_DIR: '/m'
    });
    expect(p.burstWindowMs).toBe(7_200_000);
  });
  it('reads --memory and --all', () => {
    const p = parseArgs(['list', '--memory', '/x', '--all'], {});
    expect(p.memoryDir).toBe('/x');
    expect(p.all).toBe(true);
  });
  it('reads --format text', () => {
    const p = parseArgs(['list', '--format', 'text'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.format).toBe('text');
  });
  it('throws on missing subcommand', () => {
    expect(() => parseArgs([], {})).toThrow(/subcommand/);
  });
  it('throws on unknown subcommand', () => {
    expect(() => parseArgs(['frobnicate'], {})).toThrow(/unknown subcommand/);
  });
  it('throws on unknown flag', () => {
    expect(() => parseArgs(['list', '--bogus'], {})).toThrow(/unknown flag/);
  });
  it('throws on non-integer --threshold', () => {
    expect(() => parseArgs(['list', '--threshold', 'abc'], {})).toThrow(
      /positive integer/
    );
    expect(() => parseArgs(['list', '--threshold', '0'], {})).toThrow(
      /positive integer/
    );
    expect(() => parseArgs(['list', '--threshold', '1.5'], {})).toThrow(
      /positive integer/
    );
  });
  it('throws on negative --burst-ms', () => {
    expect(() => parseArgs(['list', '--burst-ms', '-1'], {})).toThrow(
      /non-negative/
    );
  });
  it('throws on invalid --format', () => {
    expect(() => parseArgs(['list', '--format', 'yaml'], {})).toThrow(
      /text\|json/
    );
  });
});

describe('main list', () => {
  let memoryDir: string;
  beforeEach(() => {
    memoryDir = mkdtempSync(join(tmpdir(), 'mentor-cluster-cli-'));
  });
  afterEach(() => {
    // tmpdir auto-cleaned by OS
  });

  it('prints empty result when no clusters meet threshold', async () => {
    // Seed one proposal — won't meet default threshold=3
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-relitigation-foo');
    store.close();

    const io = await runMain(['list', '--memory', memoryDir]);
    expect(io.exitCode).toBe(0);
    const out = JSON.parse(io.stdout.join('\n')) as {
      systemicCount: number;
      totalClusters: number;
      clusters: unknown[];
    };
    expect(out.totalClusters).toBe(1);
    expect(out.systemicCount).toBe(0);
    expect(out.clusters).toHaveLength(0);
  });

  it('prints systemic clusters by default (>=3)', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-prematurecompletion-x-y');
    seedProposal(store, '20260505-100100-prematurecompletion-x-y-2');
    seedProposal(store, '20260505-100200-prematurecompletion-x-y-3');
    seedProposal(store, '20260505-100300-prematurecompletion-x-y-4');
    store.close();

    const io = await runMain(['list', '--memory', memoryDir]);
    expect(io.exitCode).toBe(0);
    const out = JSON.parse(io.stdout.join('\n')) as {
      systemicCount: number;
      clusters: { occurrenceCount: number; topicSlug: string }[];
    };
    expect(out.systemicCount).toBe(1);
    expect(out.clusters[0]?.occurrenceCount).toBe(4);
    expect(out.clusters[0]?.topicSlug).toBe('x-y');
  });

  it('--all includes one-off clusters', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-relitigation-foo');
    seedProposal(store, '20260505-100100-decisionclassifierviolation-bar');
    store.close();

    const io = await runMain(['list', '--memory', memoryDir, '--all']);
    expect(io.exitCode).toBe(0);
    const out = JSON.parse(io.stdout.join('\n')) as {
      clusters: { occurrenceCount: number }[];
    };
    expect(out.clusters).toHaveLength(2);
  });

  it('--threshold lowers the systemic bar', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-relitigation-foo');
    seedProposal(store, '20260505-100100-relitigation-foo-2');
    store.close();

    const io = await runMain(['list', '--memory', memoryDir, '--threshold', '2']);
    expect(io.exitCode).toBe(0);
    const out = JSON.parse(io.stdout.join('\n')) as {
      systemicCount: number;
      clusters: { occurrenceCount: number }[];
    };
    expect(out.systemicCount).toBe(1);
    expect(out.clusters[0]?.occurrenceCount).toBe(2);
  });

  it('text format emits one line per cluster', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-prematurecompletion-x-y');
    seedProposal(store, '20260505-100100-prematurecompletion-x-y-2');
    seedProposal(store, '20260505-100200-prematurecompletion-x-y-3');
    store.close();

    const io = await runMain([
      'list',
      '--memory',
      memoryDir,
      '--format',
      'text'
    ]);
    expect(io.exitCode).toBe(0);
    expect(io.stdout.join('\n')).toMatch(/SYSTEMIC.*prematurecompletion\/x-y/);
  });

  it('text format renders empty-result message', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-relitigation-foo');
    store.close();
    const io = await runMain([
      'list',
      '--memory',
      memoryDir,
      '--format',
      'text'
    ]);
    expect(io.exitCode).toBe(0);
    expect(io.stdout.join('\n')).toMatch(/no clusters with occurrence >= 3/);
  });

  it('reports member sourcePaths in the JSON output', async () => {
    const store = openIndexStore({ memoryDir });
    seedProposal(store, '20260505-100000-prematurecompletion-x-y');
    seedProposal(store, '20260505-100100-prematurecompletion-x-y-2');
    seedProposal(store, '20260505-100200-prematurecompletion-x-y-3');
    store.close();

    const io = await runMain(['list', '--memory', memoryDir]);
    const out = JSON.parse(io.stdout.join('\n')) as {
      clusters: { members: { sourcePath: string; rawSlug: string }[] }[];
    };
    const paths = out.clusters[0]?.members.map((m) => m.sourcePath) ?? [];
    expect(paths).toHaveLength(3);
    expect(paths.every((p) => p.startsWith('/fake/'))).toBe(true);
  });
});

describe('main list — error paths', () => {
  it('exits 2 when index DB does not exist', async () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'mentor-cluster-cli-no-db-'));
    expect(existsSync(join(memoryDir, '_mentor-index.sqlite'))).toBe(false);

    const io = await runMain(['list', '--memory', memoryDir]);
    expect(io.exitCode).toBe(2);
    expect(io.stderr.join('\n')).toMatch(/no index DB/);
  });

  it('exits 1 on usage error', async () => {
    const io = await runMain(['frobnicate']);
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('\n')).toMatch(/unknown subcommand/);
  });

  it('help subcommand exits 0 with usage', async () => {
    const io = await runMain(['help']);
    expect(io.exitCode).toBe(0);
    expect(io.stdout.join('\n')).toMatch(/caia-mentor-cluster/);
  });
});
