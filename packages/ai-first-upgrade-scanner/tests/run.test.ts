import { describe, expect, it } from 'vitest';
import { runScan } from '../src/run.js';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';
import { CannedWebSearcher } from '../src/searcher.js';
import { StubRelevanceCritic } from '../src/relevance-filter.js';

const clock = () => new Date('2026-05-25T10:00:00Z');

describe('runScan', () => {
  it('runs end-to-end with stub adapters; writes candidate ADRs + INBOX + report', async () => {
    const fs = makeMemoryFsAdapter({
      '/s.json': JSON.stringify({ sources: [{ id: 'a', name: 'A', url: 'u', keywords: [], category: 'vendor-blog' }] }),
    });
    const searcher = new CannedWebSearcher({
      a: [{ sourceId: 'a', url: 'http://x', title: 'Hello World', publishedAt: null, excerpt: 'e' }],
    });
    const critic = new StubRelevanceCritic({
      'http://x': { relevant: true, confidence: 0.9, reason: 'r', recommendation: 'go' },
    });
    const r = await runScan({
      sourcesPath: '/s.json', decisionsRoot: '/d', inboxPath: '/i/INBOX.md', reportsRoot: '/r',
      webSearcher: searcher, relevanceCritic: critic, fs, clock, confidenceThreshold: 0.7, inboxDailyCap: 5,
    });
    expect(r.sourcesScanned).toBe(1);
    expect(r.itemsRelevant).toBe(1);
    expect(r.candidateAdrs).toHaveLength(1);
    expect(r.inboxEntries).toBe(1);
    expect(r.reportPath).toContain('daily_upgrade_scan_2026-05-25.md');
    expect(fs.exists('/i/INBOX.md')).toBe(true);
  });

  it('skips low-confidence items', async () => {
    const fs = makeMemoryFsAdapter({
      '/s.json': JSON.stringify({ sources: [{ id: 'a', name: 'A', url: 'u', keywords: [], category: 'vendor-blog' }] }),
    });
    const searcher = new CannedWebSearcher({
      a: [{ sourceId: 'a', url: 'http://x', title: 'X', publishedAt: null, excerpt: '' }],
    });
    const critic = new StubRelevanceCritic({
      'http://x': { relevant: true, confidence: 0.5, reason: '', recommendation: '' },
    });
    const r = await runScan({
      sourcesPath: '/s.json', decisionsRoot: '/d', inboxPath: '/i/INBOX.md', reportsRoot: '/r',
      webSearcher: searcher, relevanceCritic: critic, fs, clock,
    });
    expect(r.itemsRelevant).toBe(0);
    expect(r.candidateAdrs).toEqual([]);
  });
});
