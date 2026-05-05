/**
 * Tests for the retrieval API.
 *
 * Strategy: build a tiny synthetic index by hand (writing rows directly
 * via the store), then run `retrieveLessons` against it with a fake
 * embedder. This avoids needing Ollama running for unit tests.
 *
 * The fake embedder produces deterministic vectors keyed off the
 * prompt's first character so we can construct queries that are known
 * to match (or not match) specific seeded rows.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { vectorToBlob } from '../src/embed.js';
import { openIndexStore, type IndexStore } from '../src/index-store.js';
import {
  cosineSimilarity,
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_TOP_N,
  formatLessonsPreamble,
  retrieveLessons,
  type RetrievedLesson
} from '../src/retrieve.js';
import type { Embedder, LessonKind } from '../src/types.js';

/**
 * Build a deterministic 4-dim fake vector keyed by a tag. Tags that
 * share their first character produce identical vectors → cosine
 * similarity = 1; different first chars → vectors are orthogonal so
 * cosine = 0.
 */
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

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3, 4]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(
      cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))
    ).toBeCloseTo(0, 5);
  });
  it('returns -1 for anti-parallel vectors', () => {
    expect(
      cosineSimilarity(new Float32Array([1, 0]), new Float32Array([-1, 0]))
    ).toBeCloseTo(-1, 5);
  });
  it('returns 0 when either vector has 0 norm', () => {
    expect(
      cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))
    ).toBe(0);
  });
  it('throws on dim mismatch', () => {
    expect(() =>
      cosineSimilarity(new Float32Array([1, 2]), new Float32Array([1, 2, 3]))
    ).toThrow(/dim mismatch/);
  });
});

describe('retrieveLessons', () => {
  let memoryDir: string;
  let dbPath: string;
  let store: IndexStore | null = null;

  beforeEach(() => {
    memoryDir = mkdtempSync(join(tmpdir(), 'mentor-retrieval-r-'));
    dbPath = join(memoryDir, 'test-index.sqlite');
  });
  afterEach(() => {
    store?.close();
    store = null;
  });

  it('returns empty array when index does not exist yet', async () => {
    const out = await retrieveLessons('hello', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath: join(memoryDir, 'no-such-index.sqlite')
    });
    expect(out).toEqual([]);
  });

  it('returns empty array when index is empty', async () => {
    store = openIndexStore({ memoryDir, dbPath });
    store.close();
    store = null;
    const out = await retrieveLessons('hello', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath
    });
    expect(out).toEqual([]);
  });

  it('returns rows above the similarity threshold, sorted desc', async () => {
    store = openIndexStore({ memoryDir, dbPath });
    seedRow(store, {
      sourcePath: '/m/exact-match.md',
      kind: 'feedback',
      slug: 'exact-match',
      tag: 'A', // matches query "A"
      content: 'this is the matching lesson'
    });
    seedRow(store, {
      sourcePath: '/m/orthogonal.md',
      kind: 'feedback',
      slug: 'orthogonal',
      tag: 'B', // orthogonal to "A"
      content: 'totally unrelated'
    });
    store.close();
    store = null;

    const out = await retrieveLessons('A query', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath,
      minSimilarity: 0.5
    });
    expect(out.length).toBe(1);
    expect(out[0]!.slug).toBe('exact-match');
    expect(out[0]!.similarity).toBeCloseTo(1, 5);
  });

  it('honors topN', async () => {
    store = openIndexStore({ memoryDir, dbPath });
    for (let i = 0; i < 5; i++) {
      seedRow(store, {
        sourcePath: `/m/m${i}.md`,
        kind: 'feedback',
        slug: `m${i}`,
        tag: 'A',
        content: `content ${i}`,
        mtimeMs: 1000 + i
      });
    }
    store.close();
    store = null;

    const out = await retrieveLessons('A', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath,
      topN: 2
    });
    expect(out.length).toBe(2);
    // Tiebreak by mtime desc -> m4 before m3
    expect(out[0]!.slug).toBe('m4');
    expect(out[1]!.slug).toBe('m3');
  });

  it('filters by kind when kindFilter is set', async () => {
    store = openIndexStore({ memoryDir, dbPath });
    seedRow(store, {
      sourcePath: '/m/fb.md',
      kind: 'feedback',
      slug: 'fb',
      tag: 'A',
      content: 'feedback content'
    });
    seedRow(store, {
      sourcePath: '/m/proposals/p.md',
      kind: 'proposal',
      slug: 'p',
      tag: 'A',
      content: 'proposal content'
    });
    store.close();
    store = null;

    const onlyFeedback = await retrieveLessons('A', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath,
      kindFilter: 'feedback'
    });
    expect(onlyFeedback.map((l) => l.kind)).toEqual(['feedback']);

    const onlyProposal = await retrieveLessons('A', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath,
      kindFilter: 'proposal'
    });
    expect(onlyProposal.map((l) => l.kind)).toEqual(['proposal']);
  });

  it('skips rows whose dim disagrees with the query, with a warning', async () => {
    store = openIndexStore({ memoryDir, dbPath });
    // Insert a row with the wrong dim (8 instead of 4).
    store.upsertLesson({
      sourcePath: '/m/wrong-dim.md',
      kind: 'feedback',
      slug: 'wd',
      mtimeMs: 1,
      contentSha256: 'sha',
      contentSnippet: 'wd snippet',
      embeddingDim: 8,
      embedding: vectorToBlob(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0])),
      indexedAtMs: 1
    });
    seedRow(store, {
      sourcePath: '/m/right-dim.md',
      kind: 'feedback',
      slug: 'rd',
      tag: 'A',
      content: 'rd snippet'
    });
    store.close();
    store = null;

    const warn = vi.fn();
    const out = await retrieveLessons('A', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath,
      warn
    });
    expect(out.length).toBe(1);
    expect(out[0]!.slug).toBe('rd');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('indexed dim 8 != query dim 4')
    );
  });

  it('threshold filters out low-similarity results', async () => {
    store = openIndexStore({ memoryDir, dbPath });
    seedRow(store, {
      sourcePath: '/m/orthogonal.md',
      kind: 'feedback',
      slug: 'o',
      tag: 'B', // orthogonal -> sim = 0
      content: 'unrelated'
    });
    store.close();
    store = null;

    const out = await retrieveLessons('A', {
      memoryDir,
      embed: fakeEmbed(),
      dbPath,
      minSimilarity: 0.1
    });
    expect(out).toEqual([]);
  });

  it('uses the right defaults', () => {
    expect(DEFAULT_TOP_N).toBe(5);
    expect(DEFAULT_MIN_SIMILARITY).toBe(0.4);
  });
});

describe('formatLessonsPreamble', () => {
  it('returns empty string when no lessons', () => {
    expect(formatLessonsPreamble([])).toBe('');
  });

  it('produces the directive-spec preamble for non-empty lessons', () => {
    const lessons: RetrievedLesson[] = [
      {
        path: '/m/feedback_pat_topic.md',
        kind: 'feedback',
        slug: 'feedback_pat_topic',
        similarity: 0.823,
        snippet: 'do not flag PAT-in-bashrc as a leak\n(see settled topic)',
        mtimeMs: 100
      },
      {
        path: '/m/proposals/x.md',
        kind: 'proposal',
        slug: 'x',
        similarity: 0.55,
        snippet: 'recent incident: classifier fired on git status output',
        mtimeMs: 200
      }
    ];
    const out = formatLessonsPreamble(lessons);
    expect(out).toContain('Lessons from past similar work — do not repeat:');
    expect(out).toContain('1. feedback_pat_topic (kind=feedback, similarity=0.823)');
    expect(out).toContain('2. x (kind=proposal, similarity=0.550)');
    expect(out).toContain('do not flag PAT-in-bashrc');
  });

  it('respects maxSnippetLines', () => {
    const lessons: RetrievedLesson[] = [
      {
        path: '/m/x.md',
        kind: 'feedback',
        slug: 'x',
        similarity: 1,
        snippet: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10',
        mtimeMs: 1
      }
    ];
    const out = formatLessonsPreamble(lessons, { maxSnippetLines: 3 });
    const lines = out.split('\n');
    const indented = lines.filter((l) => l.startsWith('   '));
    expect(indented.length).toBe(3);
  });
});
