import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractMentions, mentionsToQuery } from '../src/rag/extract_mentions.js';
import { injectFiles } from '../src/rag/inject.js';
import {
  __resetIndexCache,
  __setIndex,
  topK,
  lookupByPaths,
  type FileIndex,
  type IndexEntry,
} from '../src/rag/index.js';
import { runRag } from '../src/rag/middleware.js';

// Build a tiny synthetic file index in memory so the tests don't depend on
// ~/.caia/router/file_index.json existing on the box that runs CI.
function makeIndex(entries: Partial<IndexEntry>[]): FileIndex {
  const filled: IndexEntry[] = entries.map((e, i) => ({
    path: e.path ?? `/tmp/fake/${i}.ts`,
    rel: e.rel ?? `tmp/fake/${i}.ts`,
    size: e.size ?? 0,
    preview: e.preview ?? `// preview-${i}`,
    vector: e.vector ?? [1, 0, 0, 0],
  }));
  return {
    version: 1,
    model: 'nomic-embed-text',
    dim: filled[0]?.vector.length ?? 0,
    built_at: new Date().toISOString(),
    entries: filled,
  };
}

describe('rag/extract_mentions', () => {
  it('captures package-relative TypeScript paths', () => {
    const m = extractMentions('Please refactor packages/local-llm-router/src/classifier-v2.ts and add tests.');
    expect(m.hasMentions).toBe(true);
    expect(m.paths).toContain('packages/local-llm-router/src/classifier-v2.ts');
  });

  it('captures absolute and home-relative paths', () => {
    const m = extractMentions('See ~/Documents/projects/caia/packages/foo/bar.py and /tmp/scratch/test.md');
    expect(m.paths).toEqual(expect.arrayContaining([
      '~/Documents/projects/caia/packages/foo/bar.py',
      '/tmp/scratch/test.md',
    ]));
  });

  it('captures camelCase and snake_case symbols', () => {
    const m = extractMentions('The function classifyV2 calls keyword_prepass and then nextTier.');
    expect(m.symbols).toEqual(expect.arrayContaining(['classifyV2', 'keyword_prepass', 'nextTier']));
  });

  it('returns hasMentions=false on plain prose', () => {
    const m = extractMentions('Summarize the quarterly report in three sentences.');
    expect(m.hasMentions).toBe(false);
  });

  it('mentionsToQuery prefers paths when present', () => {
    const m = extractMentions('Refactor packages/foo/bar.ts thoroughly.');
    const q = mentionsToQuery(m, 'Refactor packages/foo/bar.ts thoroughly.');
    expect(q).toContain('packages/foo/bar.ts');
  });
});

describe('rag/index', () => {
  beforeEach(() => { __resetIndexCache(); });
  afterEach(() => { __resetIndexCache(); });

  it('lookupByPaths finds an entry by trailing-segment match', () => {
    const idx = makeIndex([
      { rel: 'packages/local-llm-router/src/classifier-v2.ts', path: '/abs/packages/local-llm-router/src/classifier-v2.ts' },
      { rel: 'packages/other/something.ts', path: '/abs/packages/other/something.ts' },
    ]);
    const got = lookupByPaths(['packages/local-llm-router/src/classifier-v2.ts'], 3, idx);
    expect(got.length).toBe(1);
    expect(got[0]?.rel).toBe('packages/local-llm-router/src/classifier-v2.ts');
  });

  it('topK orders entries by cosine similarity', () => {
    const idx = makeIndex([
      { rel: 'a.ts', vector: [1, 0, 0] },
      { rel: 'b.ts', vector: [0, 1, 0] },
      { rel: 'c.ts', vector: [0.5, 0.5, 0] },
    ]);
    const hits = topK([1, 0, 0], 2, idx);
    expect(hits[0]?.entry.rel).toBe('a.ts');
    expect(hits[1]?.entry.rel).toBe('c.ts');
  });
});

describe('rag/inject', () => {
  it('returns empty injection on empty entries', () => {
    const r = injectFiles({ entries: [] });
    expect(r.systemMessage).toBe('');
    expect(r.filesIncluded).toBe(0);
  });

  it('formats files with headers and respects per-file char budget', () => {
    const tinyBudget = 200; // tokens × 4 = 800 chars total budget
    const entries: IndexEntry[] = [
      {
        path: '/nonexistent/aaa.ts', rel: 'aaa.ts', size: 0,
        preview: 'X'.repeat(400),
        vector: [],
      },
    ];
    const r = injectFiles({ entries, similarities: [0.9], tokenBudget: tinyBudget });
    expect(r.filesIncluded).toBe(1);
    expect(r.systemMessage).toContain('CAIA RAG context');
    expect(r.systemMessage).toContain('aaa.ts');
    expect(r.systemMessage).toContain('(sim=0.900)');
  });
});

describe('rag/middleware — injection on a known-file prompt', () => {
  beforeEach(() => { __resetIndexCache(); });
  afterEach(() => {
    __resetIndexCache();
    __setIndex(null);
  });

  it('injects context when the prompt mentions a path in the index', async () => {
    // Seed an in-memory index with one entry that corresponds to a file we
    // know exists in the repo (this very test file).
    const knownPath = '/Users/macbook32/Documents/projects/caia/packages/local-llm-router/__tests__/rag.test.ts';
    const idx = makeIndex([
      {
        path: knownPath,
        rel: 'packages/local-llm-router/__tests__/rag.test.ts',
        size: 1234,
        preview: 'rag.test.ts preview',
        vector: [1, 0, 0, 0],
      },
    ]);
    __setIndex(idx);

    const decision = await runRag(
      'Read packages/local-llm-router/__tests__/rag.test.ts and explain.',
      { enabled: true, forceIndex: idx },
    );

    expect(decision.injected).toBe(true);
    expect(decision.reason).toBe('injected-by-path');
    expect(decision.filesIncluded).toBe(1);
    expect(decision.systemPrepend).toContain('CAIA RAG context');
    expect(decision.systemPrepend).toContain('rag.test.ts');
    expect(decision.matchedPaths).toContain('packages/local-llm-router/__tests__/rag.test.ts');
  });

  it('skips injection when RAG is disabled', async () => {
    const d = await runRag('something packages/foo/bar.ts', { enabled: false });
    expect(d.injected).toBe(false);
    expect(d.reason).toBe('disabled');
  });

  it('skips injection when prompt has no file/symbol mentions', async () => {
    const idx = makeIndex([{ rel: 'x.ts', vector: [1, 0] }]);
    const d = await runRag('how are you today', { enabled: true, forceIndex: idx });
    expect(d.injected).toBe(false);
    expect(d.reason).toBe('no-mentions');
  });
});
