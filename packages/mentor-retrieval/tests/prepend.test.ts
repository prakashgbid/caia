/**
 * Tests for the orchestrator pre-spawn hook.
 *
 * Strategy: seed a tiny synthetic index by hand, inject a fake
 * embedder, then exercise `prependLessons` directly. No real Ollama
 * required.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { vectorToBlob } from '../src/embed.js';
import { openIndexStore, type IndexStore } from '../src/index-store.js';
import { prependLessons } from '../src/prepend.js';
import type { Embedder, LessonKind } from '../src/types.js';

function fakeVector(tag: string): Float32Array {
  const ch = tag.charCodeAt(0) % 4;
  const v = new Float32Array(4);
  v[ch] = 1;
  return v;
}

function fakeEmbed(): Embedder {
  return async (text: string) => ({
    vector: fakeVector(text),
    model: 'fake-embed'
  });
}

function seedRow(
  store: IndexStore,
  args: {
    sourcePath: string;
    kind: LessonKind;
    slug: string;
    tag: string;
    content: string;
    mtimeMs?: number;
  }
): void {
  store.upsertLesson({
    sourcePath: args.sourcePath,
    kind: args.kind,
    slug: args.slug,
    mtimeMs: args.mtimeMs ?? 1000,
    contentSha256: 'sha-' + args.slug,
    contentSnippet: args.content,
    embeddingDim: 4,
    embedding: vectorToBlob(fakeVector(args.tag)),
    indexedAtMs: 1
  });
}

describe('prependLessons', () => {
  let memoryDir: string;
  let dbPath: string;
  let store: IndexStore | null = null;

  beforeEach(() => {
    memoryDir = mkdtempSync(join(tmpdir(), 'mentor-prepend-'));
    dbPath = join(memoryDir, 'idx.sqlite');
  });
  afterEach(() => {
    store?.close();
    store = null;
  });

  it('returns the original prompt unchanged when no lessons match', async () => {
    store = openIndexStore({ memoryDir, dbPath });
    seedRow(store, {
      sourcePath: '/m/feedback_b.md',
      kind: 'feedback',
      slug: 'fb_b',
      tag: 'B',
      content: 'b lesson'
    });
    store.close();
    store = null;

    const out = await prependLessons('A query that does not match', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath,
      minSimilarity: 0.99
    });
    expect(out.augmented).toBe(false);
    expect(out.augmentedPrompt).toBe('A query that does not match');
    expect(out.lessons).toEqual([]);
    expect(out.preambleLength).toBe(0);
  });

  it('returns the original prompt when index does not exist', async () => {
    const out = await prependLessons('Anything', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath: join(memoryDir, 'no-such-index.sqlite')
    });
    expect(out.augmented).toBe(false);
    expect(out.augmentedPrompt).toBe('Anything');
    expect(out.lessons).toEqual([]);
  });

  it('prepends the preamble + 2 newlines + original prompt when lessons match', async () => {
    store = openIndexStore({ memoryDir, dbPath });
    seedRow(store, {
      sourcePath: '/m/feedback_a.md',
      kind: 'feedback',
      slug: 'feedback_a',
      tag: 'A',
      content: 'lesson body for A'
    });
    store.close();
    store = null;

    const original = 'A is the prompt';
    const out = await prependLessons(original, {
      memoryDir,
      embed: fakeEmbed(),
      dbPath
    });
    expect(out.augmented).toBe(true);
    expect(out.augmentedPrompt).toContain('Lessons from past similar work');
    expect(out.augmentedPrompt).toContain('feedback_a');
    expect(out.augmentedPrompt.endsWith(original)).toBe(true);
    expect(out.lessons.length).toBe(1);
    expect(out.preambleLength).toBeGreaterThan(0);
  });

  it('honors topN and threshold', async () => {
    store = openIndexStore({ memoryDir, dbPath });
    for (let i = 0; i < 6; i++) {
      seedRow(store, {
        sourcePath: `/m/m${i}.md`,
        kind: 'feedback',
        slug: `m${i}`,
        tag: 'A',
        content: `c${i}`,
        mtimeMs: 1000 + i
      });
    }
    store.close();
    store = null;

    const out = await prependLessons('A', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath,
      topN: 3
    });
    expect(out.lessons.length).toBe(3);
    // Tiebreak by mtime desc → m5, m4, m3
    expect(out.lessons.map((l) => l.slug)).toEqual(['m5', 'm4', 'm3']);
  });

  it('passes kindFilter through to retrieval', async () => {
    store = openIndexStore({ memoryDir, dbPath });
    seedRow(store, {
      sourcePath: '/m/fb.md',
      kind: 'feedback',
      slug: 'fb',
      tag: 'A',
      content: 'fb body'
    });
    seedRow(store, {
      sourcePath: '/m/proposals/p.md',
      kind: 'proposal',
      slug: 'p',
      tag: 'A',
      content: 'proposal body'
    });
    store.close();
    store = null;

    const onlyFeedback = await prependLessons('A', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath,
      kindFilter: 'feedback'
    });
    expect(onlyFeedback.lessons.map((l) => l.kind)).toEqual(['feedback']);

    const onlyProposal = await prependLessons('A', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath,
      kindFilter: 'proposal'
    });
    expect(onlyProposal.lessons.map((l) => l.kind)).toEqual(['proposal']);
  });

  it('threads the warn callback to the retrieval layer', async () => {
    store = openIndexStore({ memoryDir, dbPath });
    // Seed a row with a wrong dim to trigger the dim-mismatch warning.
    store.upsertLesson({
      sourcePath: '/m/wd.md',
      kind: 'feedback',
      slug: 'wd',
      mtimeMs: 1,
      contentSha256: 'h',
      contentSnippet: 'wd body',
      embeddingDim: 8,
      embedding: vectorToBlob(new Float32Array(8)),
      indexedAtMs: 1
    });
    store.close();
    store = null;

    const warn = vi.fn();
    await prependLessons('A', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath,
      warn
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('indexed dim 8 != query dim 4')
    );
  });

  it('builds a default Ollama embedder when none is provided (and propagates ollamaUrl)', async () => {
    // We can't actually hit Ollama here, but we can assert the default
    // embedder is built when `embed` is omitted, by intercepting fetch.
    const origFetch = globalThis.fetch;
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ embedding: [1, 0, 0, 0] }),
      text: async () => ''
    }) as unknown as Response);
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    try {
      // Empty index → no lessons, but embed must still be called once.
      store = openIndexStore({ memoryDir, dbPath });
      store.close();
      store = null;
      await prependLessons('hello', {
        memoryDir,
        dbPath,
        ollamaUrl: 'http://my-ollama.test:9999'
      });
      expect(fakeFetch).toHaveBeenCalledTimes(1);
      const url = fakeFetch.mock.calls[0]![0];
      expect(url).toBe('http://my-ollama.test:9999/api/embeddings');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('preambleLength matches the substring length', async () => {
    store = openIndexStore({ memoryDir, dbPath });
    seedRow(store, {
      sourcePath: '/m/x.md',
      kind: 'feedback',
      slug: 'x',
      tag: 'A',
      content: 'x lesson'
    });
    store.close();
    store = null;

    const out = await prependLessons('Aprompt', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath
    });
    // The augmented prompt is `${preamble}\n${prompt}`, so:
    //   augmentedPrompt.length === preambleLength + 1 + prompt.length
    expect(out.augmentedPrompt.length).toBe(out.preambleLength + 1 + 'Aprompt'.length);
  });
});
