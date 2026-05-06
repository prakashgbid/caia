import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  INDEX_DB_FILENAME,
  indexDbPath,
  openIndexStore,
  SNIPPET_MAX_BYTES
} from '../src/index-store.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'librarian-store-test-'));
}

describe('index-store', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = makeDir();
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('exports the canonical filename + snippet cap', () => {
    expect(INDEX_DB_FILENAME).toBe('_librarian-index.sqlite');
    expect(SNIPPET_MAX_BYTES).toBe(4096);
  });

  it('builds the DB path under memoryDir', () => {
    expect(indexDbPath('/x/y')).toBe('/x/y/_librarian-index.sqlite');
  });

  it('initializes the schema idempotently', () => {
    const s1 = openIndexStore({ memoryDir: tmpRoot });
    s1.close();
    // open again — should not throw, schema already there
    const s2 = openIndexStore({ memoryDir: tmpRoot });
    expect(s2.listAll()).toEqual([]);
    s2.close();
  });

  it('upserts and lists rows in source_path order', () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    const blob = Buffer.alloc(8); // 2 floats
    store.upsertPrecedent({
      sourcePath: '/x/zzz.md',
      kind: 'feedback',
      slug: 'zzz',
      mtimeMs: 1,
      contentSha256: 'aa',
      contentSnippet: 'z',
      embeddingDim: 2,
      embedding: blob,
      indexedAtMs: 100
    });
    store.upsertPrecedent({
      sourcePath: '/x/aaa.md',
      kind: 'directive',
      slug: 'aaa',
      mtimeMs: 1,
      contentSha256: 'bb',
      contentSnippet: 'a',
      embeddingDim: 2,
      embedding: blob,
      indexedAtMs: 100
    });
    const all = store.listAll();
    expect(all.map((r) => r.slug)).toEqual(['aaa', 'zzz']);
    store.close();
  });

  it('upsert replaces an existing row by source_path', () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    const blob = Buffer.alloc(8);
    store.upsertPrecedent({
      sourcePath: '/x/foo.md',
      kind: 'feedback',
      slug: 'foo',
      mtimeMs: 1,
      contentSha256: 'aa',
      contentSnippet: 'v1',
      embeddingDim: 2,
      embedding: blob,
      indexedAtMs: 100
    });
    store.upsertPrecedent({
      sourcePath: '/x/foo.md',
      kind: 'feedback',
      slug: 'foo',
      mtimeMs: 2,
      contentSha256: 'bb',
      contentSnippet: 'v2',
      embeddingDim: 2,
      embedding: blob,
      indexedAtMs: 200
    });
    const all = store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.contentSnippet).toBe('v2');
    expect(all[0]?.mtimeMs).toBe(2);
    store.close();
  });

  it('countByKind returns zero-initialized buckets only for kinds that exist', () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    const blob = Buffer.alloc(8);
    store.upsertPrecedent({
      sourcePath: '/x/a.md',
      kind: 'feedback',
      slug: 'a',
      mtimeMs: 1,
      contentSha256: 'aa',
      contentSnippet: 'a',
      embeddingDim: 2,
      embedding: blob,
      indexedAtMs: 100
    });
    store.upsertPrecedent({
      sourcePath: '/x/b.md',
      kind: 'directive',
      slug: 'b',
      mtimeMs: 1,
      contentSha256: 'bb',
      contentSnippet: 'b',
      embeddingDim: 2,
      embedding: blob,
      indexedAtMs: 100
    });
    store.upsertPrecedent({
      sourcePath: '/x/c.md',
      kind: 'directive',
      slug: 'c',
      mtimeMs: 1,
      contentSha256: 'cc',
      contentSnippet: 'c',
      embeddingDim: 2,
      embedding: blob,
      indexedAtMs: 100
    });
    expect(store.countByKind()).toEqual({ feedback: 1, directive: 2 });
    store.close();
  });

  it('getBySourcePath + deleteBySourcePath behave correctly', () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    const blob = Buffer.alloc(8);
    store.upsertPrecedent({
      sourcePath: '/x/foo.md',
      kind: 'report',
      slug: 'foo',
      mtimeMs: 1,
      contentSha256: 'aa',
      contentSnippet: 'foo',
      embeddingDim: 2,
      embedding: blob,
      indexedAtMs: 100
    });
    expect(store.getBySourcePath('/x/foo.md')?.slug).toBe('foo');
    expect(store.getBySourcePath('/x/missing.md')).toBeNull();
    expect(store.deleteBySourcePath('/x/missing.md')).toBe(false);
    expect(store.deleteBySourcePath('/x/foo.md')).toBe(true);
    expect(store.getBySourcePath('/x/foo.md')).toBeNull();
    store.close();
  });

  it('meta keys round-trip', () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    expect(store.getMeta('foo')).toBeNull();
    store.setMeta('foo', '42');
    expect(store.getMeta('foo')).toBe('42');
    store.setMeta('foo', '43');
    expect(store.getMeta('foo')).toBe('43');
    store.close();
  });

  it('coerces unrecognized kinds to "other" when reading rows', () => {
    const store = openIndexStore({ memoryDir: tmpRoot });
    const blob = Buffer.alloc(8);
    // Insert via raw SQL with a kind not in our enum
    store.db.prepare(
      `INSERT INTO precedent
        (source_path, kind, slug, mtime_ms, content_sha256, content_snippet,
         embedding_dim, embedding_blob, indexed_at_ms)
       VALUES ('/x/future.md', 'futurekind', 'future', 1, 'aa', 'fut', 2, ?, 100)`
    ).run(blob);
    const all = store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.kind).toBe('other');
    store.close();
  });

  it('readonly mode forbids writes but permits listAll', () => {
    const writer = openIndexStore({ memoryDir: tmpRoot });
    const blob = Buffer.alloc(8);
    writer.upsertPrecedent({
      sourcePath: '/x/foo.md',
      kind: 'feedback',
      slug: 'foo',
      mtimeMs: 1,
      contentSha256: 'aa',
      contentSnippet: 'foo',
      embeddingDim: 2,
      embedding: blob,
      indexedAtMs: 100
    });
    writer.close();

    const reader = openIndexStore({ memoryDir: tmpRoot, readonly: true });
    expect(reader.listAll()).toHaveLength(1);
    expect(() =>
      reader.upsertPrecedent({
        sourcePath: '/x/bar.md',
        kind: 'feedback',
        slug: 'bar',
        mtimeMs: 1,
        contentSha256: 'aa',
        contentSnippet: 'bar',
        embeddingDim: 2,
        embedding: blob,
        indexedAtMs: 100
      })
    ).toThrow();
    reader.close();
  });

  it('close() is idempotent', () => {
    const s = openIndexStore({ memoryDir: tmpRoot });
    s.close();
    expect(() => s.close()).not.toThrow();
  });
});
