/**
 * Unit tests for the Mem0 backend.
 *
 * The fake `Memory` (in `mem0-backend.fixture.ts`) means these tests
 * never touch Ollama, the network, or the real `mem0ai` package.
 * Production wiring is exercised by the same code path; only the
 * `memoryFactory` constructor seam is replaced.
 *
 * Hard-constraint reminder: per `feedback_no_api_key_billing.md`, no
 * test (and no production code path) is allowed to require an
 * Anthropic or OpenAI API key. The fake satisfies the
 * `Mem0MemoryLike` interface entirely in-process, so the test suite
 * is offline-clean.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildMem0Index,
  buildMem0Config,
  Mem0Backend,
  retrieveMem0Precedent,
  DEFAULT_MEM0_USER_ID,
  MEM0_INDEX_DB_FILENAME,
  type Mem0BackendOptions
} from '../../src/backends/mem0-backend.js';
import {
  buildIndexWithBackend,
  retrieveWithBackend,
  prependWithBackend
} from '../../src/backends/dispatcher.js';
import { isLibrarianBackendName, DEFAULT_BACKEND } from '../../src/backends/types.js';

import { createFakeMemory } from './mem0-backend.fixture.js';

function buildBackendWithFake(overrides: Partial<Mem0BackendOptions> = {}): {
  backend: Mem0Backend;
  fake: ReturnType<typeof createFakeMemory>;
  memoryDir: string;
  cleanup: () => void;
} {
  const tmp = mkdtempSync(join(tmpdir(), 'librarian-mem0-test-'));
  const memoryDir = join(tmp, 'memory');
  mkdirSync(memoryDir, { recursive: true });
  const fake = createFakeMemory({ dimension: 32 });
  const backend = new Mem0Backend({
    memoryDir,
    userId: 'fixture-corpus',
    memoryFactory: () => fake,
    ...overrides
  });
  return {
    backend,
    fake,
    memoryDir,
    cleanup: () => rmSync(tmp, { recursive: true, force: true })
  };
}

describe('isLibrarianBackendName', () => {
  it('accepts known backend names', () => {
    expect(isLibrarianBackendName('sqlite-vec')).toBe(true);
    expect(isLibrarianBackendName('mem0')).toBe(true);
  });
  it('rejects unknown values', () => {
    expect(isLibrarianBackendName('qdrant')).toBe(false);
    expect(isLibrarianBackendName(undefined)).toBe(false);
    expect(isLibrarianBackendName(42)).toBe(false);
  });
  it('exposes a sane default', () => {
    // 2026-05-08: default flipped from 'sqlite-vec' to 'mem0' after
    // A/B parity (Mem0 won 7/10 vs sqlite-vec 3/10) and operator
    // "scaling forward" authorization. See
    // feedback_validation_decisions_2026-05-06.md decision #4.
    expect(DEFAULT_BACKEND).toBe('mem0');
  });
});

describe('Mem0Backend constructor', () => {
  it('throws on missing memoryDir', () => {
    expect(() => new Mem0Backend({ memoryDir: '' })).toThrow(/memoryDir is required/);
  });
  it('applies CAIA defaults when only memoryDir is provided', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'librarian-defaults-'));
    try {
      const b = new Mem0Backend({ memoryDir: tmp });
      expect(b.userId).toBe(DEFAULT_MEM0_USER_ID);
      expect(b.embedModel).toBe('nomic-embed-text');
      expect(b.embedDim).toBe(768);
      expect(b.ollamaUrl).toBe('http://127.0.0.1:11434');
      expect(b.indexPath.endsWith(MEM0_INDEX_DB_FILENAME)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  it('honours all constructor overrides (parameterisation works)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'librarian-overrides-'));
    try {
      const b = new Mem0Backend({
        memoryDir: tmp,
        vectorStoreDbPath: '/custom/vector.db',
        historyDbPath: '/custom/history.db',
        userId: 'fixture-corpus',
        ollamaUrl: 'http://localhost:9999',
        embedModel: 'nomic-embed-text',
        embedDim: 1536,
        extractionModel: 'llama3.1:8b'
      });
      expect(b.indexPath).toBe('/custom/vector.db');
      expect(b.historyDbPath).toBe('/custom/history.db');
      expect(b.userId).toBe('fixture-corpus');
      expect(b.ollamaUrl).toBe('http://localhost:9999');
      expect(b.embedDim).toBe(1536);
      expect(b.extractionModel).toBe('llama3.1:8b');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('buildMem0Config', () => {
  it('produces a Mem0 config that pins infer to false implicitly via metadata only', () => {
    const c = buildMem0Config({
      vectorStoreDbPath: '/tmp/vector.db',
      historyDbPath: '/tmp/history.db',
      ollamaUrl: 'http://127.0.0.1:11434',
      embedModel: 'nomic-embed-text',
      embedDim: 768,
      extractionModel: 'qwen2.5-coder:7b'
    });
    expect(c).toMatchObject({
      version: 'v1.1',
      llm: { provider: 'ollama', config: { model: 'qwen2.5-coder:7b', url: 'http://127.0.0.1:11434' } },
      embedder: { provider: 'ollama', config: { model: 'nomic-embed-text', url: 'http://127.0.0.1:11434' } },
      vectorStore: { provider: 'memory', config: { dimension: 768, dbPath: '/tmp/vector.db' } },
      historyDbPath: '/tmp/history.db'
    });
  });
});

describe('buildMem0Index', () => {
  it('embeds new files and tracks per-kind counts', async () => {
    const { backend, fake, memoryDir, cleanup } = buildBackendWithFake();
    try {
      writeFileSync(
        join(memoryDir, 'mentor_agent_directive.md'),
        'Mentor agent captures incidents and distills lessons over time.'
      );
      writeFileSync(
        join(memoryDir, 'feedback_no_api_key_billing.md'),
        'Subscription only — never use Anthropic API key.'
      );
      writeFileSync(
        join(memoryDir, 'master_backlog_sequencing_2026-05-05.md'),
        'Master backlog sequencing for the current campaign.'
      );

      const stats = await buildMem0Index({
        memoryDir,
        backend,
        log: () => undefined,
        now: () => 1_700_000_000_000
      });
      expect(stats.scanned).toBe(3);
      expect(stats.embeddedNew).toBe(3);
      expect(stats.reusedUnchanged).toBe(0);
      expect(stats.removedStale).toBe(0);
      expect(stats.failedEmbed).toBe(0);
      expect(Object.keys(stats.byKind).sort()).toEqual(['directive', 'feedback', 'master'].sort());
      expect(fake.rows.size).toBe(3);
      // Each row should have the metadata schema we promised.
      for (const row of fake.rows.values()) {
        expect(row.metadata).toMatchObject({
          source_path: expect.stringMatching(/\.md$/),
          kind: expect.any(String),
          slug: expect.any(String),
          mtime_ms: expect.any(Number),
          content_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          content_snippet: expect.any(String),
          user_id: 'fixture-corpus'
        });
      }
    } finally {
      cleanup();
    }
  });

  it('reuses unchanged files (sha + mtime match)', async () => {
    const { backend, fake, memoryDir, cleanup } = buildBackendWithFake();
    try {
      writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), 'unchanged content');
      const first = await buildMem0Index({ memoryDir, backend, log: () => undefined });
      expect(first.embeddedNew).toBe(1);
      expect(first.reusedUnchanged).toBe(0);
      const second = await buildMem0Index({ memoryDir, backend, log: () => undefined });
      expect(second.embeddedNew).toBe(0);
      expect(second.reusedUnchanged).toBe(1);
      expect(fake.rows.size).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('removes rows whose source files vanished from disk', async () => {
    const { backend, fake, memoryDir, cleanup } = buildBackendWithFake();
    try {
      writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), 'A');
      writeFileSync(join(memoryDir, 'feedback_x.md'), 'B');
      const first = await buildMem0Index({ memoryDir, backend, log: () => undefined });
      expect(first.embeddedNew).toBe(2);
      // Now remove one file and rebuild.
      rmSync(join(memoryDir, 'feedback_x.md'));
      const second = await buildMem0Index({ memoryDir, backend, log: () => undefined });
      expect(second.removedStale).toBe(1);
      expect(fake.rows.size).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('truncates content over the cap before passing to Mem0', async () => {
    const { backend, fake, memoryDir, cleanup } = buildBackendWithFake();
    try {
      const longContent = 'x'.repeat(10_000);
      writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), longContent);
      await buildMem0Index({
        memoryDir,
        backend,
        log: () => undefined,
        embedInputMaxBytes: 1024
      });
      // The fake stores `memory` = the truncated input.
      const row = Array.from(fake.rows.values())[0];
      expect(row).toBeDefined();
      expect(row?.memory.length).toBe(1024);
      // But the snippet stored in metadata is the (capped) full content.
      const snippetText = row?.metadata['content_snippet'] as string | undefined;
      expect(snippetText).toBeDefined();
      expect(snippetText?.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});

describe('retrieveMem0Precedent', () => {
  it('returns rows ordered by similarity desc and respects topN', async () => {
    const { backend, memoryDir, cleanup } = buildBackendWithFake();
    try {
      writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), 'mentor lessons incidents distill agent');
      writeFileSync(join(memoryDir, 'curator_agent_directive.md'), 'curator industry opportunities');
      writeFileSync(join(memoryDir, 'master_backlog_sequencing_2026-05-05.md'), 'master backlog scheduling items');
      await buildMem0Index({ memoryDir, backend, log: () => undefined });

      const out = await retrieveMem0Precedent('mentor lessons captured by the agent', {
        memoryDir,
        backend,
        topN: 2,
        minSimilarity: 0.0
      });
      expect(out.length).toBe(2);
      expect(out[0]?.slug).toBe('mentor_agent_directive');
      // Similarity should be > 0 since at least one token matches.
      expect(out[0]?.similarity).toBeGreaterThan(0);
      // Sorted desc.
      expect(out[0]?.similarity).toBeGreaterThanOrEqual(out[1]?.similarity ?? 0);
    } finally {
      cleanup();
    }
  });

  it('honours kindFilter to scope results', async () => {
    const { backend, memoryDir, cleanup } = buildBackendWithFake();
    try {
      writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), 'mentor agent doc');
      writeFileSync(join(memoryDir, 'feedback_no_api_key_billing.md'), 'mentor agent topic in feedback file');
      await buildMem0Index({ memoryDir, backend, log: () => undefined });

      const onlyFeedback = await retrieveMem0Precedent('mentor agent', {
        memoryDir,
        backend,
        topN: 5,
        minSimilarity: 0.0,
        kindFilter: 'feedback'
      });
      expect(onlyFeedback.length).toBe(1);
      expect(onlyFeedback[0]?.kind).toBe('feedback');

      const both = await retrieveMem0Precedent('mentor agent', {
        memoryDir,
        backend,
        topN: 5,
        minSimilarity: 0.0,
        kindFilter: ['feedback', 'directive']
      });
      expect(both.length).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('returns empty array when no results clear the threshold', async () => {
    const { backend, memoryDir, cleanup } = buildBackendWithFake();
    try {
      writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), 'mentor doc');
      await buildMem0Index({ memoryDir, backend, log: () => undefined });
      const out = await retrieveMem0Precedent('zzqxxq query that does not match anything', {
        memoryDir,
        backend,
        topN: 5,
        minSimilarity: 0.99
      });
      expect(out).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('returns empty array when retrieval errors (graceful degradation)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'librarian-mem0-error-'));
    try {
      const memoryDir = join(tmp, 'memory');
      mkdirSync(memoryDir);
      const backend = new Mem0Backend({
        memoryDir,
        memoryFactory: () => ({
          // Minimal fake that throws on search.
          add: async () => ({ results: [] }),
          search: async () => { throw new Error('synthetic failure'); },
          getAll: async () => ({ results: [] }),
          delete: async () => undefined
        })
      });
      let warned = '';
      const out = await retrieveMem0Precedent('hello', {
        memoryDir,
        backend,
        topN: 5,
        minSimilarity: 0,
        warn: (m) => { warned = m; }
      });
      expect(out).toEqual([]);
      expect(warned).toMatch(/synthetic failure/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('dispatcher: backend flag', () => {
  it('buildIndexWithBackend(backend: "mem0") routes to Mem0', async () => {
    const { backend, fake, memoryDir, cleanup } = buildBackendWithFake();
    try {
      writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), 'doc one');
      const stats = await buildIndexWithBackend({
        memoryDir,
        embed: async () => ({ vector: new Float32Array(768), model: 'unused' }),
        log: () => undefined,
        backend: 'mem0',
        mem0: { backend }
      });
      expect(stats.scanned).toBe(1);
      expect(stats.embeddedNew).toBe(1);
      expect(fake.rows.size).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('retrieveWithBackend(backend: "mem0") returns Mem0 results', async () => {
    const { backend, memoryDir, cleanup } = buildBackendWithFake();
    try {
      writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), 'mentor agent topic');
      await buildMem0Index({ memoryDir, backend, log: () => undefined });
      const out = await retrieveWithBackend('mentor agent', {
        memoryDir,
        backend: 'mem0',
        topN: 5,
        minSimilarity: 0,
        mem0: { backend }
      });
      expect(out.length).toBe(1);
      expect(out[0]?.slug).toBe('mentor_agent_directive');
    } finally {
      cleanup();
    }
  });

  it('prependWithBackend(backend: "mem0") augments the prompt with the same preamble format', async () => {
    const { backend, memoryDir, cleanup } = buildBackendWithFake();
    try {
      writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), 'mentor agent topic');
      await buildMem0Index({ memoryDir, backend, log: () => undefined });
      const r = await prependWithBackend('mentor agent', {
        memoryDir,
        backend: 'mem0',
        topN: 5,
        minSimilarity: 0,
        mem0: { backend }
      });
      expect(r.augmented).toBe(true);
      expect(r.precedent.length).toBe(1);
      // Same preamble as Phase-1.
      expect(r.augmentedPrompt.startsWith('Precedent from prior decisions — for context:')).toBe(true);
      // Original prompt is preserved at the bottom.
      expect(r.augmentedPrompt.endsWith('mentor agent')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('prependWithBackend with no matches returns the original prompt unchanged', async () => {
    const { backend, memoryDir, cleanup } = buildBackendWithFake();
    try {
      writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), 'mentor agent');
      await buildMem0Index({ memoryDir, backend, log: () => undefined });
      const r = await prependWithBackend('totally unrelated zzqxxq', {
        memoryDir,
        backend: 'mem0',
        topN: 5,
        minSimilarity: 0.99,  // unreachable threshold
        mem0: { backend }
      });
      expect(r.augmented).toBe(false);
      expect(r.augmentedPrompt).toBe('totally unrelated zzqxxq');
      expect(r.precedent).toEqual([]);
      expect(r.preambleLength).toBe(0);
    } finally {
      cleanup();
    }
  });
});

/**
 * Phase-2 default-flip parity smoke test (2026-05-08).
 *
 * Per the Phase-2 brief: "write a small integration test that proves
 * both backends pass the same suite of operations." The two backends
 * have separate test surfaces elsewhere — this suite runs the same
 * sequence of build → retrieve → prepend operations against BOTH
 * backends back-to-back and asserts the result shapes are
 * structurally compatible (same `RetrievedPrecedent` keys, same
 * preamble format, same prompt-augmentation semantics).
 *
 * Similarity scores are NOT compared across backends — Mem0's
 * `MemoryVectorStore` uses unnormalized cosine similarity while the
 * Phase-1 path uses normalized cosine. Callers comparing across
 * backends should use rank order, not raw scores.
 *
 * Both backends are exercised offline:
 *   - sqlite-vec via a deterministic `embed` stub.
 *   - Mem0 via the same `createFakeMemory` fixture used elsewhere.
 *
 * No Ollama, no network, no API keys.
 */
describe('parity smoke: same operations across both backends', () => {
  // Deterministic embed stub for the sqlite-vec backend. Returns a
  // stable 768-dim zero vector — sqlite-vec's Phase-1 retrieve will
  // match all rows at similarity 0, which is fine for this smoke test
  // because we only assert structural shape (not score order).
  const stubEmbed = async (): Promise<{ vector: Float32Array; model: string }> => ({
    vector: new Float32Array(768),
    model: 'parity-stub'
  });

  it('build → retrieve → prepend produces structurally compatible outputs on both backends', async () => {
    // Set up a fresh corpus directory used by BOTH backends.
    const tmp = mkdtempSync(join(tmpdir(), 'librarian-parity-'));
    const memoryDir = join(tmp, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      join(memoryDir, 'mentor_agent_directive.md'),
      'mentor agent topic — pre-spawn injection rules'
    );

    const fake = createFakeMemory({ dimension: 32 });
    const mem0 = new Mem0Backend({
      memoryDir,
      userId: 'parity-fixture',
      memoryFactory: () => fake
    });

    try {
      // ---- BUILD ----
      const sqliteStats = await buildIndexWithBackend({
        memoryDir,
        embed: stubEmbed,
        log: () => undefined,
        backend: 'sqlite-vec'
      });
      const mem0Stats = await buildIndexWithBackend({
        memoryDir,
        embed: stubEmbed,  // unused on the mem0 path
        log: () => undefined,
        backend: 'mem0',
        mem0: { backend: mem0 }
      });

      // Both backends scan the same number of files and report the
      // same per-kind counts shape (BuildIndexStats).
      expect(sqliteStats.scanned).toBe(1);
      expect(mem0Stats.scanned).toBe(1);
      expect(sqliteStats.embeddedNew).toBe(1);
      expect(mem0Stats.embeddedNew).toBe(1);
      // Same key shape on the result objects.
      expect(Object.keys(sqliteStats).sort()).toEqual(
        Object.keys(mem0Stats).sort()
      );

      // ---- RETRIEVE ----
      const sqliteHits = await retrieveWithBackend('mentor agent', {
        memoryDir,
        backend: 'sqlite-vec',
        embed: stubEmbed,
        topN: 5,
        minSimilarity: 0
      });
      const mem0Hits = await retrieveWithBackend('mentor agent', {
        memoryDir,
        backend: 'mem0',
        topN: 5,
        minSimilarity: 0,
        mem0: { backend: mem0 }
      });

      // Both backends found the doc.
      expect(sqliteHits.length).toBeGreaterThan(0);
      expect(mem0Hits.length).toBeGreaterThan(0);
      // Same RetrievedPrecedent key shape on every row.
      const sqliteKeys = Object.keys(sqliteHits[0] ?? {}).sort();
      const mem0Keys = Object.keys(mem0Hits[0] ?? {}).sort();
      expect(sqliteKeys).toEqual(mem0Keys);
      // Both surface the corpus slug we wrote.
      expect(sqliteHits.some((r) => r.slug === 'mentor_agent_directive')).toBe(true);
      expect(mem0Hits.some((r) => r.slug === 'mentor_agent_directive')).toBe(true);

      // ---- PREPEND ----
      const sqlitePrepended = await prependWithBackend('mentor agent', {
        memoryDir,
        backend: 'sqlite-vec',
        embed: stubEmbed,
        topN: 5,
        minSimilarity: 0
      });
      const mem0Prepended = await prependWithBackend('mentor agent', {
        memoryDir,
        backend: 'mem0',
        topN: 5,
        minSimilarity: 0,
        mem0: { backend: mem0 }
      });

      // Both augmented the prompt.
      expect(sqlitePrepended.augmented).toBe(true);
      expect(mem0Prepended.augmented).toBe(true);
      // Both used the byte-identical preamble header.
      const HEADER = 'Precedent from prior decisions — for context:';
      expect(sqlitePrepended.augmentedPrompt.startsWith(HEADER)).toBe(true);
      expect(mem0Prepended.augmentedPrompt.startsWith(HEADER)).toBe(true);
      // Both preserve the original prompt at the tail.
      expect(sqlitePrepended.augmentedPrompt.endsWith('mentor agent')).toBe(true);
      expect(mem0Prepended.augmentedPrompt.endsWith('mentor agent')).toBe(true);
      // PrependPrecedentResult key shape matches on both backends.
      expect(Object.keys(sqlitePrepended).sort()).toEqual(
        Object.keys(mem0Prepended).sort()
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('default backend (no explicit flag) routes to mem0 after Phase-2 default-flip', async () => {
    const { backend, fake, memoryDir, cleanup } = buildBackendWithFake();
    try {
      writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), 'topic');
      // Omit `backend:` flag entirely — should route to DEFAULT_BACKEND.
      const stats = await buildIndexWithBackend({
        memoryDir,
        embed: async () => ({ vector: new Float32Array(768), model: 'unused' }),
        log: () => undefined,
        mem0: { backend }
      });
      expect(stats.scanned).toBe(1);
      // Confirm it landed in the mem0 fake (proves the default routed
      // through the mem0 dispatcher, not the sqlite-vec dispatcher).
      expect(fake.rows.size).toBe(1);
    } finally {
      cleanup();
    }
  });
});
