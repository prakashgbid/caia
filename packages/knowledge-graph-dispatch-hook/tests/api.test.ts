/**
 * api.test.ts — unit tests for `injectContext` and `deriveQuery`.
 *
 * We don't boot a real AKG here (that's the integration test). Instead we
 * stub `archSearch` via a mocked import of `@chiefaia/architecture-registry`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalHits, result, stubEmbedder } from './fixtures.js';

vi.mock('@chiefaia/architecture-registry', async () => {
  const actual =
    await vi.importActual<typeof import('@chiefaia/architecture-registry')>(
      '@chiefaia/architecture-registry',
    );
  return {
    ...actual,
    archSearch: vi.fn(),
  };
});

import { archSearch } from '@chiefaia/architecture-registry';
import { deriveQuery, injectContext } from '../src/api.js';
import type { DispatchBrief } from '../src/types.js';

const mockedArchSearch = archSearch as unknown as ReturnType<typeof vi.fn>;

function brief(over: Partial<DispatchBrief> = {}): DispatchBrief {
  return {
    callerAgentId: 'agent-1',
    briefMd: 'Investigate event-sourcing options for the leaderboard.',
    intent: 'research',
    ...over,
  };
}

const fakeDb = {} as unknown as import('better-sqlite3').Database;

beforeEach(() => {
  mockedArchSearch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deriveQuery', () => {
  it('honours queryOverride first', () => {
    expect(deriveQuery(brief({ briefSummary: 'B' }), { queryOverride: 'A' })).toBe('A');
  });

  it('uses briefSummary when present and no override', () => {
    expect(deriveQuery(brief({ briefSummary: 'S' }))).toBe('S');
  });

  it('falls back to briefMd head capped at briefSummaryMaxChars', () => {
    const md = 'x'.repeat(2000);
    expect(deriveQuery(brief({ briefMd: md }), { briefSummaryMaxChars: 100 })).toHaveLength(100);
  });

  it('defaults briefSummaryMaxChars to 1200', () => {
    const md = 'x'.repeat(2000);
    expect(deriveQuery(brief({ briefMd: md }))).toHaveLength(1200);
  });
});

describe('injectContext — short circuits', () => {
  it('disabled short-circuits without calling archSearch', async () => {
    const out = await injectContext(brief(), { db: fakeDb, embedder: stubEmbedder() }, {
      disabled: true,
    });
    expect(mockedArchSearch).not.toHaveBeenCalled();
    expect(out.stats.fallbackUsed).toBe('disabled');
    expect(out.preamble).toBe('');
    expect(out.brief).toBe(brief().briefMd);
    expect(out.callerAgentId).toBe('agent-1');
  });

  it('empty query short-circuits to empty-kg', async () => {
    const out = await injectContext(brief({ briefMd: '' }), { db: fakeDb, embedder: stubEmbedder() });
    expect(out.stats.fallbackUsed).toBe('empty-kg');
    expect(mockedArchSearch).not.toHaveBeenCalled();
  });
});

describe('injectContext — happy path', () => {
  it('prepends the preamble to brief and reports fallbackUsed=none', async () => {
    mockedArchSearch.mockResolvedValue(result(canonicalHits()));
    const out = await injectContext(brief(), { db: fakeDb, embedder: stubEmbedder() });
    expect(out.stats.fallbackUsed).toBe('none');
    expect(out.preamble).toContain('## Architecture Context (auto-injected by AKG)');
    expect(out.brief.startsWith(out.preamble)).toBe(true);
    expect(out.brief.includes(brief().briefMd)).toBe(true);
    expect(out.retrieved.length).toBeGreaterThan(0);
  });

  it('preambleOnly returns the original brief unchanged but still exposes preamble', async () => {
    mockedArchSearch.mockResolvedValue(result(canonicalHits()));
    const b = brief();
    const out = await injectContext(b, { db: fakeDb, embedder: stubEmbedder() }, {
      preambleOnly: true,
    });
    expect(out.brief).toBe(b.briefMd);
    expect(out.preamble.length).toBeGreaterThan(0);
  });

  it('reports retrievedCount and sourcesByKind accurately', async () => {
    mockedArchSearch.mockResolvedValue(result(canonicalHits()));
    const out = await injectContext(brief(), { db: fakeDb, embedder: stubEmbedder() });
    const total =
      out.stats.sourcesByKind.adr +
      out.stats.sourcesByKind.principle +
      out.stats.sourcesByKind.lesson +
      out.stats.sourcesByKind.feedback +
      out.stats.sourcesByKind.other;
    expect(total).toBe(out.stats.retrievedCount);
  });
});

describe('injectContext — failure handling', () => {
  it('archSearch throws => fallbackUsed=embedder-down and brief passes through', async () => {
    mockedArchSearch.mockRejectedValue(new Error('boom'));
    const b = brief();
    const out = await injectContext(b, { db: fakeDb, embedder: stubEmbedder() });
    expect(out.stats.fallbackUsed).toBe('embedder-down');
    expect(out.brief).toBe(b.briefMd);
    expect(out.preamble).toBe('');
  });

  it('zero hits from archSearch => fallbackUsed=empty-kg', async () => {
    mockedArchSearch.mockResolvedValue(result([]));
    const out = await injectContext(brief(), { db: fakeDb, embedder: stubEmbedder() });
    expect(out.stats.fallbackUsed).toBe('empty-kg');
    expect(out.retrieved.length).toBe(0);
    expect(out.preamble).toBe('');
  });
});
