import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndex, sha256Hex, snippet } from '../src/index-builder.js';
import { openIndexStore } from '../src/index-store.js';
import type { Embedder, FsReader, SourceFile } from '../src/types.js';

function det768(seed: number): Float32Array {
  const v = new Float32Array(768);
  let s = seed;
  for (let i = 0; i < 768; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    v[i] = ((s % 1000) / 1000) - 0.5;
  }
  return v;
}

function fakeEmbed(seedFor: (text: string) => number): Embedder {
  return async (text: string) => ({ vector: det768(seedFor(text)), model: 'fake' });
}

function makeFsReader(files: Array<{ path: string; kind: SourceFile['kind']; content: string; mtimeMs: number }>): FsReader {
  return {
    readDir() {
      return files.map((f) => ({
        path: f.path,
        kind: f.kind,
        mtimeMs: f.mtimeMs,
        size: f.content.length
      }));
    },
    readFile(p) {
      const f = files.find((x) => x.path === p);
      if (!f) throw new Error(`not found: ${p}`);
      return f.content;
    }
  };
}

describe('sha256Hex', () => {
  it('produces a 64-char hex digest', () => {
    const h = sha256Hex('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // sha256("hello") well-known
    expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});

describe('snippet', () => {
  it('returns content unchanged when within cap', () => {
    expect(snippet('hello world')).toBe('hello world');
  });
  it('truncates content past 4 KB without breaking utf-8', () => {
    const content = 'a'.repeat(5000);
    expect(snippet(content).length).toBe(4096);
  });
});

describe('buildIndex', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'librarian-build-test-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('embeds new sources, returns stats, persists rows', async () => {
    const fs = makeFsReader([
      { path: '/m/feedback_a.md', kind: 'feedback', content: 'first', mtimeMs: 100 },
      { path: '/m/dir_b.md', kind: 'directive', content: 'second', mtimeMs: 200 }
    ]);
    const seedMap: Record<string, number> = { first: 1, second: 2 };
    const stats = await buildIndex({
      memoryDir: tmpRoot,
      embed: fakeEmbed((t) => seedMap[t] ?? 99),
      fsReader: fs,
      log: () => undefined
    });
    expect(stats.scanned).toBe(2);
    expect(stats.embeddedNew).toBe(2);
    expect(stats.reusedUnchanged).toBe(0);
    expect(stats.removedStale).toBe(0);
    expect(stats.failedEmbed).toBe(0);
    expect(stats.byKind).toEqual({ feedback: 1, directive: 1 });

    const store = openIndexStore({ memoryDir: tmpRoot, readonly: true });
    expect(store.listAll()).toHaveLength(2);
    expect(store.getMeta('embedding_model')).toBe('fake');
    expect(store.getMeta('embedding_dim')).toBe('768');
    expect(store.getMeta('last_build_scanned')).toBe('2');
    expect(store.getMeta('last_build_at_ms')).toMatch(/^\d+$/);
    store.close();
  });

  it('reuses unchanged rows on incremental rebuild', async () => {
    const fs = makeFsReader([
      { path: '/m/feedback_a.md', kind: 'feedback', content: 'same', mtimeMs: 100 }
    ]);
    let embedCalls = 0;
    const embed: Embedder = async () => {
      embedCalls++;
      return { vector: det768(7), model: 'fake' };
    };
    await buildIndex({ memoryDir: tmpRoot, embed, fsReader: fs, log: () => undefined });
    expect(embedCalls).toBe(1);

    // second pass — same mtime + same content
    const stats2 = await buildIndex({ memoryDir: tmpRoot, embed, fsReader: fs, log: () => undefined });
    expect(embedCalls).toBe(1); // no new embed
    expect(stats2.embeddedNew).toBe(0);
    expect(stats2.reusedUnchanged).toBe(1);
  });

  it('re-embeds on content change (sha differs)', async () => {
    const v1 = makeFsReader([
      { path: '/m/feedback_a.md', kind: 'feedback', content: 'v1', mtimeMs: 100 }
    ]);
    const v2 = makeFsReader([
      { path: '/m/feedback_a.md', kind: 'feedback', content: 'v2-different', mtimeMs: 100 }
    ]);
    let calls = 0;
    const embed: Embedder = async () => {
      calls++;
      return { vector: det768(calls), model: 'fake' };
    };
    await buildIndex({ memoryDir: tmpRoot, embed, fsReader: v1, log: () => undefined });
    await buildIndex({ memoryDir: tmpRoot, embed, fsReader: v2, log: () => undefined });
    expect(calls).toBe(2);
    const store = openIndexStore({ memoryDir: tmpRoot, readonly: true });
    const all = store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.contentSnippet).toBe('v2-different');
    store.close();
  });

  it('removes rows whose source vanished from disk', async () => {
    const v1 = makeFsReader([
      { path: '/m/a.md', kind: 'feedback', content: 'a', mtimeMs: 100 },
      { path: '/m/b.md', kind: 'feedback', content: 'b', mtimeMs: 100 }
    ]);
    const v2 = makeFsReader([
      { path: '/m/a.md', kind: 'feedback', content: 'a', mtimeMs: 100 }
    ]);
    const embed: Embedder = async () => ({ vector: det768(1), model: 'fake' });
    await buildIndex({ memoryDir: tmpRoot, embed, fsReader: v1, log: () => undefined });
    const stats = await buildIndex({ memoryDir: tmpRoot, embed, fsReader: v2, log: () => undefined });
    expect(stats.removedStale).toBe(1);
    const store = openIndexStore({ memoryDir: tmpRoot, readonly: true });
    expect(store.listAll().map((r) => r.sourcePath)).toEqual(['/m/a.md']);
    store.close();
  });

  it('continues past a single embed failure (does not erase prior row)', async () => {
    // Pre-seed
    const v1 = makeFsReader([
      { path: '/m/a.md', kind: 'feedback', content: 'a', mtimeMs: 100 }
    ]);
    const ok: Embedder = async () => ({ vector: det768(1), model: 'fake' });
    await buildIndex({ memoryDir: tmpRoot, embed: ok, fsReader: v1, log: () => undefined });

    // Now an embed that throws on a NEW (not pre-seeded) file's content,
    // and a second source with different content that succeeds.
    const v2 = makeFsReader([
      { path: '/m/a.md', kind: 'feedback', content: 'a', mtimeMs: 100 },         // unchanged → reuse
      { path: '/m/b.md', kind: 'feedback', content: 'fail-me', mtimeMs: 100 },   // throws
      { path: '/m/c.md', kind: 'feedback', content: 'fine', mtimeMs: 100 }        // ok
    ]);
    const flaky: Embedder = async (text: string) => {
      if (text === 'fail-me') throw new Error('ollama down');
      return { vector: det768(text === 'fine' ? 11 : 22), model: 'fake' };
    };
    const stats = await buildIndex({ memoryDir: tmpRoot, embed: flaky, fsReader: v2, log: () => undefined });
    expect(stats.failedEmbed).toBe(1);
    expect(stats.embeddedNew).toBe(1); // c.md
    expect(stats.reusedUnchanged).toBe(1); // a.md
    expect(stats.removedStale).toBe(0); // a.md not removed despite b.md failing

    const store = openIndexStore({ memoryDir: tmpRoot, readonly: true });
    const paths = store.listAll().map((r) => r.sourcePath);
    expect(paths).toContain('/m/a.md');
    expect(paths).toContain('/m/c.md');
    expect(paths).not.toContain('/m/b.md');
    store.close();
  });

  it('byKind reflects only rows that exist after the build', async () => {
    const fs = makeFsReader([
      { path: '/m/feedback_a.md', kind: 'feedback', content: 'a', mtimeMs: 1 },
      { path: '/m/feedback_b.md', kind: 'feedback', content: 'b', mtimeMs: 1 },
      { path: '/m/master_x.md', kind: 'master', content: 'x', mtimeMs: 1 },
      { path: '/r/leg-1.md', kind: 'report', content: 'r', mtimeMs: 1 }
    ]);
    const embed: Embedder = async () => ({ vector: det768(1), model: 'fake' });
    const stats = await buildIndex({ memoryDir: tmpRoot, embed, fsReader: fs, log: () => undefined });
    expect(stats.byKind).toEqual({ feedback: 2, master: 1, report: 1 });
  });

  it('records elapsedMs as a non-negative number', async () => {
    const fs = makeFsReader([]);
    const embed: Embedder = async () => ({ vector: det768(1), model: 'fake' });
    const stats = await buildIndex({ memoryDir: tmpRoot, embed, fsReader: fs, log: () => undefined });
    expect(stats.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

import { DEFAULT_EMBED_INPUT_MAX_BYTES, truncateUtf8 } from '../src/index-builder.js';

describe('truncateUtf8', () => {
  it('returns content unchanged when within cap', () => {
    expect(truncateUtf8('hello', 100)).toBe('hello');
  });
  it('truncates at the byte cap on an ASCII boundary', () => {
    expect(truncateUtf8('a'.repeat(100), 50)).toHaveLength(50);
  });
  it('truncates without splitting a multi-byte UTF-8 codepoint', () => {
    // each em-dash '—' is 3 bytes (E2 80 94)
    const content = 'A—B—C—D—E';
    // a naive truncate at 4 bytes would split the second em-dash;
    // truncateUtf8 should land on a codepoint boundary
    const out = truncateUtf8(content, 4);
    expect(Buffer.byteLength(out, 'utf-8')).toBeLessThanOrEqual(4);
    // and out should still be valid UTF-8
    expect(() => Buffer.from(out, 'utf-8').toString('utf-8')).not.toThrow();
    // specifically: 'A—' is 4 bytes (1 + 3); 'A—B' is 5; so 'A—' is the right answer
    expect(out).toBe('A—');
  });
});

describe('DEFAULT_EMBED_INPUT_MAX_BYTES', () => {
  it('is conservatively below nomic-embed-text default ctx', () => {
    expect(DEFAULT_EMBED_INPUT_MAX_BYTES).toBeGreaterThan(2048); // not too tight
    expect(DEFAULT_EMBED_INPUT_MAX_BYTES).toBeLessThanOrEqual(8192); // not too loose
  });
});

describe('buildIndex truncation', () => {
  it('feeds at most embedInputMaxBytes to the embedder', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'librarian-build-trunc-'));
    try {
      const longContent = 'x'.repeat(100000);
      const fs: FsReader = {
        readDir: () => [{ path: '/m/long.md', kind: 'feedback', mtimeMs: 1, size: longContent.length }],
        readFile: () => longContent
      };
      let receivedLength = 0;
      const embed: Embedder = async (text) => {
        receivedLength = Buffer.byteLength(text, 'utf-8');
        return { vector: new Float32Array(8), model: 'fake' };
      };
      const stats = await buildIndex({
        memoryDir: tmpRoot,
        embed,
        fsReader: fs,
        log: () => undefined,
        embedInputMaxBytes: 1024
      });
      expect(stats.embeddedNew).toBe(1);
      expect(receivedLength).toBeLessThanOrEqual(1024);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('feeds full content when cap is 0 (escape hatch)', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'librarian-build-no-trunc-'));
    try {
      const content = 'x'.repeat(50000);
      const fs: FsReader = {
        readDir: () => [{ path: '/m/long.md', kind: 'feedback', mtimeMs: 1, size: content.length }],
        readFile: () => content
      };
      let receivedLength = 0;
      const embed: Embedder = async (text) => {
        receivedLength = Buffer.byteLength(text, 'utf-8');
        return { vector: new Float32Array(8), model: 'fake' };
      };
      await buildIndex({
        memoryDir: tmpRoot,
        embed,
        fsReader: fs,
        log: () => undefined,
        embedInputMaxBytes: 0
      });
      expect(receivedLength).toBe(50000);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('persists embed_input_max_bytes meta key', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'librarian-build-meta-'));
    try {
      const fs: FsReader = {
        readDir: () => [{ path: '/m/short.md', kind: 'feedback', mtimeMs: 1, size: 5 }],
        readFile: () => 'hello'
      };
      const embed: Embedder = async () => ({ vector: new Float32Array(8), model: 'fake' });
      await buildIndex({
        memoryDir: tmpRoot,
        embed,
        fsReader: fs,
        log: () => undefined,
        embedInputMaxBytes: 1234
      });
      const { openIndexStore } = await import('../src/index-store.js');
      const store = openIndexStore({ memoryDir: tmpRoot, readonly: true });
      expect(store.getMeta('embed_input_max_bytes')).toBe('1234');
      store.close();
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
