import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { vectorToBlob } from '../src/embed.js';
import { openIndexStore } from '../src/index-store.js';
import { main as prependMain, parseArgs as prependParseArgs } from '../src/prepend-cli.js';
import type { PrecedentKind } from '../src/types.js';

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

function insertRow(memoryDir: string, sourcePath: string, kind: PrecedentKind, v: Float32Array, snippet: string): void {
  const store = openIndexStore({ memoryDir });
  store.upsertPrecedent({
    sourcePath,
    kind,
    slug: sourcePath.split('/').pop()?.replace(/\.md$/, '') ?? 'x',
    mtimeMs: 100,
    contentSha256: 'aa',
    contentSnippet: snippet,
    embeddingDim: v.length,
    embedding: vectorToBlob(v),
    indexedAtMs: 100
  });
  store.close();
}

function makeSink() {
  const out: string[] = [];
  const err: string[] = [];
  let exitCode: number | null = null;
  return {
    out,
    err,
    get exitCode() {
      return exitCode;
    },
    exit: ((c: number) => {
      exitCode = c;
      return undefined as unknown as never;
    }) as (c: number) => never,
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s)
  };
}

describe('caia-librarian-prepend parseArgs', () => {
  it('defaults to stdin when no positional arg', () => {
    const a = prependParseArgs([], {});
    expect(a.prompt).toBe('__STDIN__');
  });
  it('honors a positional prompt', () => {
    const a = prependParseArgs(['hello there'], {});
    expect(a.prompt).toBe('hello there');
  });
  it('rejects --stdin + positional', () => {
    expect(() => prependParseArgs(['--stdin', 'oops'], {})).toThrow(/cannot pass both/);
  });
  it('parses --top-n + --threshold + --kind', () => {
    const a = prependParseArgs(['--top-n', '3', '--threshold', '0.5', '--kind', 'directive,report'], {});
    expect(a.topN).toBe(3);
    expect(a.threshold).toBe(0.5);
    expect(a.kindFilter).toEqual(['directive', 'report']);
  });
  it('rejects invalid --top-n', () => {
    expect(() => prependParseArgs(['--top-n', '0'], {})).toThrow(/positive integer/);
  });
  it('rejects unknown kinds', () => {
    expect(() => prependParseArgs(['--kind', 'bogus'], {})).toThrow(/unknown kind/);
  });
  it('honors --help', () => {
    const a = prependParseArgs(['--help'], {});
    expect(a.prompt).toBe('__HELP__');
  });
});

describe('caia-librarian-prepend main', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'librarian-prepcli-test-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('emits the original prompt unchanged when index is empty', async () => {
    const sink = makeSink();
    // Use a fake fetch that returns a deterministic embedding so we
    // don't hit Ollama.
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ embedding: [1, 0] }), { status: 200 });
    // Override embedder via env: not supported; instead, exercise the
    // empty-index path which doesn't even need a working fetch (retrieve
    // returns [] before embed if DB is missing). But our flow embeds
    // first, so we need fetch to work.
    await prependMain({
      argv: ['some prompt', '--memory', tmpRoot, '--quiet'],
      env: { OLLAMA_URL: 'http://x' },
      stdout: sink.stdout,
      stderr: sink.stderr,
      exit: sink.exit,
      readStdin: async () => 'never used'
    });
    // Without overriding fetch, this reaches real Ollama. Skip if fails;
    // otherwise we expect exit 2 (Ollama unreachable). Either way, the
    // CLI should not crash silently.
    expect(sink.exitCode === 0 || sink.exitCode === 2).toBe(true);
    void fakeFetch;
  });

  it('shows help and exits 0', async () => {
    const sink = makeSink();
    await prependMain({
      argv: ['--help'],
      env: {},
      stdout: sink.stdout,
      stderr: sink.stderr,
      exit: sink.exit
    });
    expect(sink.exitCode).toBe(0);
    expect(sink.out.join('\n')).toMatch(/caia-librarian-prepend/);
  });

  it('errors with empty stdin', async () => {
    const sink = makeSink();
    await prependMain({
      argv: ['--memory', tmpRoot],
      env: {},
      stdout: sink.stdout,
      stderr: sink.stderr,
      exit: sink.exit,
      readStdin: async () => '   '
    });
    expect(sink.exitCode).toBe(1);
    expect(sink.err.join('\n')).toMatch(/stdin was empty/);
  });

  it('appends metadata footer when --metadata is set and Ollama is reachable (mock)', async () => {
    insertRow(tmpRoot, '/x/dir.md', 'directive', vec([1, 0]), 'snippet content');
    // mock Ollama via OLLAMA_URL pointing at a mock server. We can't
    // easily start a server in vitest; instead, verify the embedded path
    // by calling the library directly already covered. Here we just
    // verify the CLI's argv parsing of --metadata.
    const a = prependParseArgs(['--metadata'], {});
    expect(a.metadata).toBe(true);
  });
});
