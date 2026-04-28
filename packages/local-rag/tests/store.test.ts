import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VectorStore } from '../src/store.js';
import type { EmbeddedChunk } from '../src/types.js';

let tmpdir: string;
let dbPath: string;
let store: VectorStore;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-rag-test-'));
  dbPath = path.join(tmpdir, 'test.db');
  store = new VectorStore(dbPath);
});

afterEach(() => {
  store.close();
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

function chunk(
  id: string,
  filePath: string,
  embedding: number[],
): EmbeddedChunk {
  return {
    id,
    path: filePath,
    startLine: 1,
    endLine: 10,
    content: `chunk ${id}`,
    embedding: Float32Array.from(embedding),
  };
}

describe('VectorStore', () => {
  it('starts empty', () => {
    expect(store.count()).toBe(0);
  });

  it('upserts and counts chunks', () => {
    store.upsert([
      chunk('a', 'a.ts', [1, 0, 0]),
      chunk('b', 'b.ts', [0, 1, 0]),
    ]);
    expect(store.count()).toBe(2);
  });

  it('replaces a chunk on duplicate id (idempotent re-index)', () => {
    store.upsert([chunk('a', 'a.ts', [1, 0, 0])]);
    store.upsert([chunk('a', 'a.ts', [0, 1, 0])]);
    expect(store.count()).toBe(1);

    const hits = store.search(Float32Array.from([0, 1, 0]), 5, 0);
    expect(hits[0]!.score).toBeCloseTo(1, 4);
  });

  it('clearForPath removes only chunks for that path', () => {
    store.upsert([
      chunk('a1', 'a.ts', [1, 0, 0]),
      chunk('a2', 'a.ts', [0, 1, 0]),
      chunk('b1', 'b.ts', [0, 0, 1]),
    ]);
    store.clearForPath('a.ts');
    expect(store.count()).toBe(1);
  });

  it('search returns hits sorted by cosine similarity', () => {
    store.upsert([
      chunk('match', 'a.ts', [1, 0, 0]),
      chunk('orth', 'b.ts', [0, 1, 0]),
      chunk('opp', 'c.ts', [-1, 0, 0]),
    ]);

    const hits = store.search(Float32Array.from([1, 0, 0]), 5, -1);
    expect(hits.map((h) => h.chunk.id)).toEqual(['match', 'orth', 'opp']);
    expect(hits[0]!.score).toBeCloseTo(1, 4);
    expect(hits[1]!.score).toBeCloseTo(0, 4);
    expect(hits[2]!.score).toBeCloseTo(-1, 4);
  });

  it('search respects topK and minScore', () => {
    store.upsert([
      chunk('a', 'a.ts', [1, 0, 0]),
      chunk('b', 'b.ts', [0.9, 0.1, 0]),
      chunk('c', 'c.ts', [0.5, 0.5, 0]),
    ]);

    const top1 = store.search(Float32Array.from([1, 0, 0]), 1, -1);
    expect(top1).toHaveLength(1);
    expect(top1[0]!.chunk.id).toBe('a');

    const filtered = store.search(Float32Array.from([1, 0, 0]), 5, 0.95);
    expect(filtered.length).toBeLessThanOrEqual(2);
    expect(filtered.every((h) => h.score >= 0.95)).toBe(true);
  });

  it('returns empty hits for a zero query vector', () => {
    store.upsert([chunk('a', 'a.ts', [1, 0, 0])]);
    const hits = store.search(Float32Array.from([0, 0, 0]), 5, -1);
    expect(hits).toEqual([]);
  });

  it('persists meta across re-opens', () => {
    store.setMeta('embedding_model', 'nomic-embed-text');
    store.close();

    const reopened = new VectorStore(dbPath);
    expect(reopened.getMeta('embedding_model')).toBe('nomic-embed-text');
    reopened.close();
  });
});
