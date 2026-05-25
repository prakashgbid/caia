import { describe, expect, it } from 'vitest';
import { CannedWebSearcher, NullWebSearcher, loadSourceList, scanSources } from '../src/searcher.js';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';
import type { SearchResult, Source } from '../src/types.js';

const s = (id: string, url: string): Source => ({ id, name: id, url, keywords: [], category: 'vendor-blog' });
const r = (sourceId: string, url: string, title = 't'): SearchResult => ({ sourceId, url, title, publishedAt: null, excerpt: '' });

describe('NullWebSearcher', () => {
  it('returns empty list', async () => {
    expect(await new NullWebSearcher().search(s('a', 'u'), '2026-01-01')).toEqual([]);
  });
});

describe('CannedWebSearcher', () => {
  it('returns canned results by source id', async () => {
    const c = new CannedWebSearcher({ a: [r('a', 'http://x')] });
    const out = await c.search(s('a', 'u'), '2026-01-01');
    expect(out).toEqual([r('a', 'http://x')]);
  });

  it('returns empty for unknown source', async () => {
    const c = new CannedWebSearcher({});
    expect(await c.search(s('b', 'u'), '2026-01-01')).toEqual([]);
  });
});

describe('scanSources', () => {
  it('aggregates results across sources', async () => {
    const c = new CannedWebSearcher({ a: [r('a', 'http://x')], b: [r('b', 'http://y')] });
    const out = await scanSources({ sources: [s('a', 'u'), s('b', 'u')], searcher: c, sinceIso: '2026-01-01' });
    expect(out.results).toHaveLength(2);
    expect(out.errors).toEqual([]);
  });

  it('captures per-source errors without aborting', async () => {
    const bad = {
      async search(src: Source) {
        if (src.id === 'b') throw new Error('boom');
        return [r(src.id, 'http://x')];
      },
    };
    const out = await scanSources({ sources: [s('a', 'u'), s('b', 'u')], searcher: bad, sinceIso: '2026-01-01' });
    expect(out.results).toHaveLength(1);
    expect(out.errors).toEqual([{ sourceId: 'b', message: 'boom' }]);
  });

  it('returns empty for empty source list', async () => {
    const out = await scanSources({ sources: [], searcher: new NullWebSearcher(), sinceIso: '2026-01-01' });
    expect(out.results).toEqual([]);
  });
});

describe('loadSourceList', () => {
  it('parses sources from JSON file', () => {
    const fs = makeMemoryFsAdapter({ '/s.json': JSON.stringify({ sources: [{ id: 'a', name: 'A', url: 'u', keywords: [], category: 'vendor-blog' }] }) });
    const out = loadSourceList('/s.json', fs);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('a');
  });

  it('returns empty when file missing', () => {
    const fs = makeMemoryFsAdapter({});
    expect(loadSourceList('/missing', fs)).toEqual([]);
  });

  it('returns empty when sources field absent', () => {
    const fs = makeMemoryFsAdapter({ '/s.json': JSON.stringify({}) });
    expect(loadSourceList('/s.json', fs)).toEqual([]);
  });

  it('filters out malformed entries', () => {
    const fs = makeMemoryFsAdapter({ '/s.json': JSON.stringify({ sources: [{ no_id: true }, { id: 'a', url: 'u', name: 'A', keywords: [], category: 'research' }] }) });
    expect(loadSourceList('/s.json', fs)).toHaveLength(1);
  });
});
