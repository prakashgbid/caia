/**
 * Tests for the index builder. Uses a fake FsReader + fake Embedder so
 * no actual filesystem state outside `tmpdir()` and no Ollama daemon
 * are required.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildIndex, sha256Hex, snippet } from '../src/index-builder.js';
import { openIndexStore, SNIPPET_MAX_BYTES, type IndexStore } from '../src/index-store.js';
import type { Embedder, FsReader, SourceFile } from '../src/types.js';

function makeFakeFs(files: Map<string, { src: SourceFile; content: string }>): FsReader {
  return {
    readDir(_memoryDir: string): SourceFile[] {
      return Array.from(files.values()).map((v) => v.src);
    },
    readFile(p: string): string {
      const v = files.get(p);
      if (!v) throw new Error(`fake fs has no ${p}`);
      return v.content;
    }
  };
}

function makeFakeEmbedder(model = 'fake-model', dim = 4): {
  embed: Embedder;
  calls: string[];
} {
  const calls: string[] = [];
  const embed: Embedder = async (text: string) => {
    calls.push(text);
    // Deterministic fake embedding: hash bytes -> first dim floats.
    const v = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      // Vary by char code so different inputs produce different vectors.
      v[i] = ((text.charCodeAt(i % text.length) || 1) * (i + 1)) / 1000;
    }
    return { vector: v, model };
  };
  return { embed, calls };
}

describe('sha256Hex', () => {
  it('is deterministic', () => {
    expect(sha256Hex('hello')).toBe(sha256Hex('hello'));
  });
  it('differs for different inputs', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });
  it('returns lowercase hex', () => {
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]+$/);
  });
});

describe('snippet', () => {
  it('returns short content unchanged', () => {
    expect(snippet('hello')).toBe('hello');
  });
  it('truncates oversized content', () => {
    const big = 'a'.repeat(SNIPPET_MAX_BYTES * 2);
    const s = snippet(big);
    expect(Buffer.byteLength(s, 'utf-8')).toBeLessThanOrEqual(SNIPPET_MAX_BYTES);
  });
});

describe('buildIndex', () => {
  let memoryDir: string;
  let dbPath: string;

  beforeEach(() => {
    memoryDir = mkdtempSync(join(tmpdir(), 'mentor-retrieval-build-'));
    dbPath = join(memoryDir, 'test-index.sqlite');
  });
  afterEach(() => {
    // tmpdir auto-cleanup
  });

  it('embeds and persists each source file once', async () => {
    const files = new Map<string, { src: SourceFile; content: string }>();
    files.set('/m/feedback_a.md', {
      src: { path: '/m/feedback_a.md', kind: 'feedback', mtimeMs: 1, size: 5 },
      content: 'hello'
    });
    files.set('/m/proposals/p1.md', {
      src: { path: '/m/proposals/p1.md', kind: 'proposal', mtimeMs: 2, size: 7 },
      content: 'goodbye'
    });

    const fsReader = makeFakeFs(files);
    const { embed, calls } = makeFakeEmbedder();

    const stats = await buildIndex({
      memoryDir,
      embed,
      fsReader,
      dbPath,
      log: () => undefined
    });

    expect(stats.scanned).toBe(2);
    expect(stats.embeddedNew).toBe(2);
    expect(stats.reusedUnchanged).toBe(0);
    expect(stats.removedStale).toBe(0);
    expect(stats.failedEmbed).toBe(0);
    expect(stats.indexPath).toBe(dbPath);
    expect(calls.length).toBe(2);

    const store = openIndexStore({ memoryDir, dbPath });
    try {
      const rows = store.listAll();
      expect(rows.length).toBe(2);
      const feedbackRow = rows.find((r) => r.kind === 'feedback');
      const proposalRow = rows.find((r) => r.kind === 'proposal');
      expect(feedbackRow).toBeDefined();
      expect(proposalRow).toBeDefined();
      expect(feedbackRow!.slug).toBe('feedback_a');
      expect(store.getMeta('embedding_model')).toBe('fake-model');
      expect(store.getMeta('embedding_dim')).toBe('4');
      expect(store.getMeta('last_build_at_ms')).not.toBeNull();
      expect(store.getMeta('last_build_scanned')).toBe('2');
    } finally {
      store.close();
    }
  });

  it('reuses existing rows when mtime + sha256 are unchanged', async () => {
    const files = new Map<string, { src: SourceFile; content: string }>();
    files.set('/m/feedback_a.md', {
      src: { path: '/m/feedback_a.md', kind: 'feedback', mtimeMs: 1, size: 5 },
      content: 'hello'
    });
    const fsReader = makeFakeFs(files);
    const { embed, calls } = makeFakeEmbedder();

    const first = await buildIndex({
      memoryDir,
      embed,
      fsReader,
      dbPath,
      log: () => undefined
    });
    expect(first.embeddedNew).toBe(1);
    expect(calls.length).toBe(1);

    const second = await buildIndex({
      memoryDir,
      embed,
      fsReader,
      dbPath,
      log: () => undefined
    });
    expect(second.embeddedNew).toBe(0);
    expect(second.reusedUnchanged).toBe(1);
    // Embedder should NOT have been called a second time.
    expect(calls.length).toBe(1);
  });

  it('re-embeds when mtime changes', async () => {
    const files = new Map<string, { src: SourceFile; content: string }>();
    files.set('/m/feedback_a.md', {
      src: { path: '/m/feedback_a.md', kind: 'feedback', mtimeMs: 1, size: 5 },
      content: 'hello'
    });
    const fsReader = makeFakeFs(files);
    const { embed, calls } = makeFakeEmbedder();

    await buildIndex({ memoryDir, embed, fsReader, dbPath, log: () => undefined });
    expect(calls.length).toBe(1);

    // Bump mtime and content
    files.set('/m/feedback_a.md', {
      src: { path: '/m/feedback_a.md', kind: 'feedback', mtimeMs: 2, size: 8 },
      content: 'hello v2'
    });
    const stats = await buildIndex({
      memoryDir,
      embed,
      fsReader,
      dbPath,
      log: () => undefined
    });
    expect(stats.embeddedNew).toBe(1);
    expect(stats.reusedUnchanged).toBe(0);
    expect(calls.length).toBe(2);
  });

  it('removes stale rows for files no longer present', async () => {
    const files = new Map<string, { src: SourceFile; content: string }>();
    files.set('/m/feedback_a.md', {
      src: { path: '/m/feedback_a.md', kind: 'feedback', mtimeMs: 1, size: 5 },
      content: 'hello'
    });
    files.set('/m/feedback_b.md', {
      src: { path: '/m/feedback_b.md', kind: 'feedback', mtimeMs: 1, size: 5 },
      content: 'world'
    });
    const fsReader = makeFakeFs(files);
    const { embed } = makeFakeEmbedder();
    await buildIndex({ memoryDir, embed, fsReader, dbPath, log: () => undefined });

    files.delete('/m/feedback_b.md');
    const stats = await buildIndex({
      memoryDir,
      embed,
      fsReader,
      dbPath,
      log: () => undefined
    });
    expect(stats.removedStale).toBe(1);

    const store = openIndexStore({ memoryDir, dbPath });
    try {
      const rows = store.listAll();
      expect(rows.length).toBe(1);
      expect(rows[0]!.sourcePath).toBe('/m/feedback_a.md');
    } finally {
      store.close();
    }
  });

  it('continues past individual embed failures and counts them', async () => {
    const files = new Map<string, { src: SourceFile; content: string }>();
    files.set('/m/a.md', {
      src: { path: '/m/a.md', kind: 'feedback', mtimeMs: 1, size: 3 },
      content: 'one'
    });
    files.set('/m/b.md', {
      src: { path: '/m/b.md', kind: 'feedback', mtimeMs: 2, size: 3 },
      content: 'two'
    });
    const fsReader = makeFakeFs(files);

    const embed: Embedder = vi.fn(async (text: string) => {
      if (text === 'two') throw new Error('embed failed for two');
      return { vector: new Float32Array([0.1, 0.2]), model: 'm' };
    });

    const log = vi.fn();
    const stats = await buildIndex({ memoryDir, embed, fsReader, dbPath, log });
    expect(stats.embeddedNew).toBe(1);
    expect(stats.failedEmbed).toBe(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('failed to index /m/b.md')
    );

    // First file should still be persisted.
    const store = openIndexStore({ memoryDir, dbPath });
    try {
      const rows = store.listAll();
      expect(rows.length).toBe(1);
      expect(rows[0]!.sourcePath).toBe('/m/a.md');
    } finally {
      store.close();
    }
  });

  it('writes meta keys on every successful pass', async () => {
    const files = new Map<string, { src: SourceFile; content: string }>();
    files.set('/m/a.md', {
      src: { path: '/m/a.md', kind: 'feedback', mtimeMs: 1, size: 1 },
      content: 'a'
    });
    const fsReader = makeFakeFs(files);
    const { embed } = makeFakeEmbedder('fancy-model', 7);

    let mockNow = 1_700_000_000_000;
    await buildIndex({
      memoryDir,
      embed,
      fsReader,
      dbPath,
      log: () => undefined,
      now: () => mockNow++
    });

    let store: IndexStore | null = null;
    try {
      store = openIndexStore({ memoryDir, dbPath, readonly: true });
      expect(store.getMeta('embedding_model')).toBe('fancy-model');
      expect(store.getMeta('embedding_dim')).toBe('7');
      expect(store.getMeta('last_build_at_ms')).not.toBeNull();
    } finally {
      store?.close();
    }
  });
});
