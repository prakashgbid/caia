/**
 * Tests for the SQLite-backed index store.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { vectorToBlob } from '../src/embed.js';
import {
  INDEX_DB_FILENAME,
  indexDbPath,
  openIndexStore,
  type IndexStore
} from '../src/index-store.js';

describe('indexDbPath', () => {
  it('joins memoryDir with the filename', () => {
    expect(indexDbPath('/x/y')).toBe(`/x/y/${INDEX_DB_FILENAME}`);
  });
});

describe('openIndexStore', () => {
  let dir: string;
  let store: IndexStore | null = null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mentor-retrieval-store-'));
  });
  afterEach(() => {
    store?.close();
    store = null;
  });

  it('creates the DB and schema on first open', () => {
    store = openIndexStore({ memoryDir: dir });
    const tables = (store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain('lessons');
    expect(tables).toContain('meta');
    expect(store.listAll()).toEqual([]);
  });

  it('upsert + listAll round-trip', () => {
    store = openIndexStore({ memoryDir: dir });
    const v = new Float32Array([1, 2, 3, 4]);
    store.upsertLesson({
      sourcePath: '/m/feedback_a.md',
      kind: 'feedback',
      slug: 'feedback_a',
      mtimeMs: 1000,
      contentSha256: 'sha-a',
      contentSnippet: 'snippet a',
      embeddingDim: v.length,
      embedding: vectorToBlob(v),
      indexedAtMs: 2000
    });
    const all = store.listAll();
    expect(all.length).toBe(1);
    expect(all[0]!.sourcePath).toBe('/m/feedback_a.md');
    expect(all[0]!.kind).toBe('feedback');
    expect(all[0]!.embeddingDim).toBe(v.length);
    expect(all[0]!.embedding.length).toBe(v.length * 4);
  });

  it('upsert is idempotent on the same source_path', () => {
    store = openIndexStore({ memoryDir: dir });
    const v1 = new Float32Array([0.1]);
    const v2 = new Float32Array([0.2, 0.3]);
    store.upsertLesson({
      sourcePath: '/m/x.md',
      kind: 'feedback',
      slug: 'x',
      mtimeMs: 100,
      contentSha256: 'h1',
      contentSnippet: 's1',
      embeddingDim: v1.length,
      embedding: vectorToBlob(v1),
      indexedAtMs: 1
    });
    store.upsertLesson({
      sourcePath: '/m/x.md',
      kind: 'proposal',
      slug: 'x',
      mtimeMs: 200,
      contentSha256: 'h2',
      contentSnippet: 's2',
      embeddingDim: v2.length,
      embedding: vectorToBlob(v2),
      indexedAtMs: 2
    });
    const all = store.listAll();
    expect(all.length).toBe(1);
    expect(all[0]!.kind).toBe('proposal');
    expect(all[0]!.embeddingDim).toBe(2);
    expect(all[0]!.contentSha256).toBe('h2');
  });

  it('getBySourcePath returns null for missing rows', () => {
    store = openIndexStore({ memoryDir: dir });
    expect(store.getBySourcePath('/missing.md')).toBeNull();
  });

  it('deleteBySourcePath returns true on hit, false on miss', () => {
    store = openIndexStore({ memoryDir: dir });
    const v = new Float32Array([0.5]);
    store.upsertLesson({
      sourcePath: '/m/y.md',
      kind: 'feedback',
      slug: 'y',
      mtimeMs: 1,
      contentSha256: 'h',
      contentSnippet: 's',
      embeddingDim: 1,
      embedding: vectorToBlob(v),
      indexedAtMs: 1
    });
    expect(store.deleteBySourcePath('/m/y.md')).toBe(true);
    expect(store.deleteBySourcePath('/m/y.md')).toBe(false);
    expect(store.listAll()).toEqual([]);
  });

  it('meta key get/set works and rejects nothing', () => {
    store = openIndexStore({ memoryDir: dir });
    expect(store.getMeta('absent')).toBeNull();
    store.setMeta('foo', 'bar');
    expect(store.getMeta('foo')).toBe('bar');
    store.setMeta('foo', 'baz');
    expect(store.getMeta('foo')).toBe('baz');
  });

  it('readonly mode forbids writes', () => {
    // Bootstrap a DB first.
    const writableStore = openIndexStore({ memoryDir: dir });
    writableStore.upsertLesson({
      sourcePath: '/m/r.md',
      kind: 'feedback',
      slug: 'r',
      mtimeMs: 1,
      contentSha256: 'h',
      contentSnippet: 's',
      embeddingDim: 1,
      embedding: vectorToBlob(new Float32Array([1])),
      indexedAtMs: 1
    });
    writableStore.close();

    store = openIndexStore({ memoryDir: dir, readonly: true });
    expect(store.listAll().length).toBe(1);
    expect(() =>
      store!.upsertLesson({
        sourcePath: '/m/q.md',
        kind: 'feedback',
        slug: 'q',
        mtimeMs: 1,
        contentSha256: 'h',
        contentSnippet: 's',
        embeddingDim: 1,
        embedding: vectorToBlob(new Float32Array([1])),
        indexedAtMs: 1
      })
    ).toThrow();
  });

  it('rejects malformed kind on read', () => {
    store = openIndexStore({ memoryDir: dir });
    // Hand-insert a bad kind to simulate corruption.
    store.db
      .prepare(
        `INSERT INTO lessons(source_path, kind, slug, mtime_ms, content_sha256,
          content_snippet, embedding_dim, embedding_blob, indexed_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('/x.md', 'bogus-kind', 'x', 1, 'h', 's', 1, vectorToBlob(new Float32Array([1])), 1);
    expect(() => store!.listAll()).toThrow(/unexpected lesson kind/);
  });

  it('respects custom dbPath override', () => {
    const customPath = join(dir, 'custom.sqlite');
    store = openIndexStore({ memoryDir: dir, dbPath: customPath });
    expect(store.dbPath).toBe(customPath);
  });
});
