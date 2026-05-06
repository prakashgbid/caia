import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { vectorToBlob } from '../src/embed.js';
import { openIndexStore } from '../src/index-store.js';
import {
  cosineSimilarity,
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_TOP_N,
  formatPrecedentPreamble,
  retrievePrecedent
} from '../src/retrieve.js';
import type { Embedder, IndexedPrecedent, PrecedentKind } from '../src/types.js';

function unitVec(angleRad: number): Float32Array {
  // 2-d vector pretending to be 4-d (last 2 zero) for tests
  const v = new Float32Array(4);
  v[0] = Math.cos(angleRad);
  v[1] = Math.sin(angleRad);
  return v;
}

function fakeEmbedder(vec: Float32Array): Embedder {
  return async () => ({ vector: vec, model: 'fake' });
}

function seedRow(opts: {
  sourcePath: string;
  kind: PrecedentKind;
  vec: Float32Array;
  snippet?: string;
  mtimeMs?: number;
}): Omit<IndexedPrecedent, 'id'> {
  return {
    sourcePath: opts.sourcePath,
    kind: opts.kind,
    slug: opts.sourcePath.split('/').pop()?.replace(/\.md$/, '') ?? 'x',
    mtimeMs: opts.mtimeMs ?? 100,
    contentSha256: 'aa',
    contentSnippet: opts.snippet ?? 'snippet',
    embeddingDim: opts.vec.length,
    embedding: vectorToBlob(opts.vec),
    indexedAtMs: 100
  };
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });
  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });
  it('returns -1 for anti-parallel vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });
  it('returns 0 when either norm is 0', () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
    expect(cosineSimilarity(new Float32Array([1, 1]), new Float32Array([0, 0]))).toBe(0);
  });
  it('throws on dim mismatch', () => {
    expect(() =>
      cosineSimilarity(new Float32Array([1]), new Float32Array([1, 1]))
    ).toThrow(/dim mismatch/);
  });
});

describe('retrievePrecedent', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'librarian-retr-test-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns empty when index does not exist (graceful)', async () => {
    const result = await retrievePrecedent('hello', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(new Float32Array(4))
    });
    expect(result).toEqual([]);
  });

  it('ranks rows by cosine similarity desc', async () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    store.upsertPrecedent(seedRow({ sourcePath: '/x/close.md', kind: 'feedback', vec: unitVec(0) }));
    store.upsertPrecedent(seedRow({ sourcePath: '/x/middle.md', kind: 'feedback', vec: unitVec(Math.PI / 4) }));
    store.upsertPrecedent(seedRow({ sourcePath: '/x/far.md', kind: 'feedback', vec: unitVec(Math.PI / 2) }));
    store.close();

    const query = unitVec(0);
    const result = await retrievePrecedent('q', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(query),
      minSimilarity: -1 // include all
    });
    expect(result.map((r) => r.slug)).toEqual(['close', 'middle', 'far']);
  });

  it('honors topN', async () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    for (let i = 0; i < 10; i++) {
      store.upsertPrecedent(seedRow({
        sourcePath: `/x/r${i}.md`,
        kind: 'feedback',
        vec: unitVec(i * 0.01)
      }));
    }
    store.close();
    const result = await retrievePrecedent('q', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(unitVec(0)),
      minSimilarity: -1,
      topN: 3
    });
    expect(result).toHaveLength(3);
  });

  it('filters by minSimilarity', async () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    store.upsertPrecedent(seedRow({ sourcePath: '/x/close.md', kind: 'feedback', vec: unitVec(0) }));
    store.upsertPrecedent(seedRow({ sourcePath: '/x/orth.md', kind: 'feedback', vec: unitVec(Math.PI / 2) }));
    store.close();
    const result = await retrievePrecedent('q', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(unitVec(0)),
      minSimilarity: 0.9
    });
    expect(result.map((r) => r.slug)).toEqual(['close']);
  });

  it('honors single-kind filter', async () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    store.upsertPrecedent(seedRow({ sourcePath: '/x/d.md', kind: 'directive', vec: unitVec(0) }));
    store.upsertPrecedent(seedRow({ sourcePath: '/x/f.md', kind: 'feedback', vec: unitVec(0) }));
    store.close();
    const result = await retrievePrecedent('q', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(unitVec(0)),
      minSimilarity: -1,
      kindFilter: 'directive'
    });
    expect(result.map((r) => r.slug)).toEqual(['d']);
  });

  it('honors multi-kind filter', async () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    store.upsertPrecedent(seedRow({ sourcePath: '/x/d.md', kind: 'directive', vec: unitVec(0) }));
    store.upsertPrecedent(seedRow({ sourcePath: '/x/r.md', kind: 'report', vec: unitVec(0) }));
    store.upsertPrecedent(seedRow({ sourcePath: '/x/f.md', kind: 'feedback', vec: unitVec(0) }));
    store.close();
    const result = await retrievePrecedent('q', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(unitVec(0)),
      minSimilarity: -1,
      kindFilter: ['directive', 'report']
    });
    expect(result.map((r) => r.slug).sort()).toEqual(['d', 'r']);
  });

  it('skips rows with mismatched embedding dim and warns once', async () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    store.upsertPrecedent(seedRow({ sourcePath: '/x/wrong.md', kind: 'feedback', vec: new Float32Array([1, 0, 0]) })); // 3-dim
    store.upsertPrecedent(seedRow({ sourcePath: '/x/right.md', kind: 'feedback', vec: unitVec(0) })); // 4-dim
    store.close();

    const warns: string[] = [];
    const result = await retrievePrecedent('q', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(unitVec(0)),
      minSimilarity: -1,
      warn: (m) => warns.push(m)
    });
    expect(result.map((r) => r.slug)).toEqual(['right']);
    expect(warns.length).toBe(1);
    expect(warns[0]).toMatch(/dim/);
  });

  it('breaks similarity ties by mtime desc', async () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    store.upsertPrecedent(seedRow({ sourcePath: '/x/old.md', kind: 'feedback', vec: unitVec(0), mtimeMs: 100 }));
    store.upsertPrecedent(seedRow({ sourcePath: '/x/new.md', kind: 'feedback', vec: unitVec(0), mtimeMs: 200 }));
    store.close();
    const result = await retrievePrecedent('q', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(unitVec(0)),
      minSimilarity: -1
    });
    expect(result.map((r) => r.slug)).toEqual(['new', 'old']);
  });

  it('exposes default constants', () => {
    expect(DEFAULT_TOP_N).toBe(5);
    expect(DEFAULT_MIN_SIMILARITY).toBe(0.4);
  });
});

describe('formatPrecedentPreamble', () => {
  it('returns empty string for empty input', () => {
    expect(formatPrecedentPreamble([])).toBe('');
  });

  it('produces a stable preamble with a leading marker line', () => {
    const text = formatPrecedentPreamble([
      {
        path: '/x/foo.md',
        kind: 'directive',
        slug: 'foo',
        similarity: 0.812345,
        snippet: 'line1\nline2\nline3',
        mtimeMs: 100
      }
    ]);
    expect(text.split('\n')[0]).toBe('Precedent from prior decisions — for context:');
    expect(text).toMatch(/1\. foo \(kind=directive, similarity=0\.812\)/);
    expect(text).toMatch(/[ ]{3}line1/);
    expect(text).toMatch(/[ ]{3}line2/);
    expect(text).toMatch(/[ ]{3}line3/);
  });

  it('caps snippet lines (default 8)', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
    const text = formatPrecedentPreamble([
      {
        path: '/x/foo.md',
        kind: 'directive',
        slug: 'foo',
        similarity: 0.5,
        snippet: lines,
        mtimeMs: 100
      }
    ]);
    expect(text).toMatch(/[ ]{3}line7/);
    expect(text).not.toMatch(/[ ]{3}line8/);
  });
});
