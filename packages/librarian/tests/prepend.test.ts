import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { vectorToBlob } from '../src/embed.js';
import { openIndexStore } from '../src/index-store.js';
import { prependPrecedent } from '../src/prepend.js';
import type { Embedder, PrecedentKind } from '../src/types.js';

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

function fakeEmbedder(v: Float32Array): Embedder {
  return async () => ({ vector: v, model: 'fake' });
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

describe('prependPrecedent', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'librarian-prepend-test-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns prompt unchanged when index is empty', async () => {
    const result = await prependPrecedent('do thing', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(vec([1, 0]))
    });
    expect(result.augmented).toBe(false);
    expect(result.augmentedPrompt).toBe('do thing');
    expect(result.precedent).toEqual([]);
    expect(result.preambleLength).toBe(0);
  });

  it('augments prompt when relevant precedent exists', async () => {
    insertRow(tmpRoot, '/x/dir.md', 'directive', vec([1, 0]), 'Pick X over Y because of decision Z');
    const result = await prependPrecedent('please pick X', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(vec([1, 0])),
      minSimilarity: -1
    });
    expect(result.augmented).toBe(true);
    expect(result.precedent).toHaveLength(1);
    expect(result.precedent[0]?.slug).toBe('dir');
    expect(result.augmentedPrompt.startsWith('Precedent from prior decisions — for context:')).toBe(true);
    expect(result.augmentedPrompt.endsWith('please pick X')).toBe(true);
    expect(result.preambleLength).toBeGreaterThan(0);
  });

  it('honors topN', async () => {
    for (let i = 0; i < 10; i++) {
      insertRow(tmpRoot, `/x/r${i}.md`, 'feedback', vec([Math.cos(i * 0.01), Math.sin(i * 0.01)]), `s${i}`);
    }
    const result = await prependPrecedent('q', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(vec([1, 0])),
      minSimilarity: -1,
      topN: 2
    });
    expect(result.precedent).toHaveLength(2);
  });

  it('honors kindFilter', async () => {
    insertRow(tmpRoot, '/x/d.md', 'directive', vec([1, 0]), 'directive');
    insertRow(tmpRoot, '/x/r.md', 'report', vec([1, 0]), 'report');
    const result = await prependPrecedent('q', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(vec([1, 0])),
      minSimilarity: -1,
      kindFilter: 'directive'
    });
    expect(result.precedent.map((p) => p.slug)).toEqual(['d']);
  });

  it('respects threshold (returns unchanged when nothing meets it)', async () => {
    insertRow(tmpRoot, '/x/d.md', 'directive', vec([0, 1]), 'orthogonal');
    const result = await prependPrecedent('q', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(vec([1, 0])),
      minSimilarity: 0.9
    });
    expect(result.augmented).toBe(false);
    expect(result.augmentedPrompt).toBe('q');
  });

  it('appends a single newline between preamble and prompt', async () => {
    insertRow(tmpRoot, '/x/d.md', 'directive', vec([1, 0]), 'snip');
    const result = await prependPrecedent('THE PROMPT', {
      memoryDir: tmpRoot,
      embed: fakeEmbedder(vec([1, 0])),
      minSimilarity: -1
    });
    // preamble is multi-line; the boundary is '\n' after the preamble's
    // trailing '\n' (preamble ends in "\n"; we add another "\n").
    expect(result.augmentedPrompt).toContain('\nTHE PROMPT');
  });
});
