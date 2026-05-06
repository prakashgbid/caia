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
    expect(DEFAULT_BACKEND).toBe('sqlite-vec');
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
