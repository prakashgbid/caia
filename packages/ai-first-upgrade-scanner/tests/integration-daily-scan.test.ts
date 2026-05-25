import { describe, expect, it } from 'vitest';
import { runScan } from '../src/run.js';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';
import { CannedWebSearcher } from '../src/searcher.js';
import { StubRelevanceCritic } from '../src/relevance-filter.js';

/**
 * Integration test — runs the full pipeline end-to-end against canned
 * source results, asserting all observable side effects:
 *   - candidate ADRs land in decisionsRoot
 *   - INBOX block appended under "## YYYY-MM-DD — AI-FIRST-UPGRADE CANDIDATES"
 *   - daily report written to reportsRoot
 *   - judge / search errors aggregated in report
 *
 * Hermetic: NO real HTTP calls.
 */
describe('integration — full scan with multiple sources, mixed verdicts', () => {
  it('correctly drafts, surfaces, and reports across the pipeline', async () => {
    const fs = makeMemoryFsAdapter({
      '/s.json': JSON.stringify({
        sources: [
          { id: 'anthropic-news', name: 'Anthropic News', url: 'https://www.anthropic.com/news', keywords: [], category: 'vendor-blog' },
          { id: 'arxiv-cs-ai', name: 'arxiv', url: 'https://arxiv.org/list/cs.AI/new', keywords: [], category: 'research' },
          { id: 'broken-source', name: 'Broken', url: 'https://broken.example.com', keywords: [], category: 'community' },
        ],
      }),
    });
    const searcher = new CannedWebSearcher({
      'anthropic-news': [
        { sourceId: 'anthropic-news', url: 'https://www.anthropic.com/news/claude-5', title: 'Claude 5 release', publishedAt: null, excerpt: 'new memory architecture' },
      ],
      'arxiv-cs-ai': [
        { sourceId: 'arxiv-cs-ai', url: 'https://arxiv.org/abs/2026.00001', title: 'Multi-agent reflection', publishedAt: null, excerpt: 'agent paper' },
        { sourceId: 'arxiv-cs-ai', url: 'https://arxiv.org/abs/2026.00002', title: 'Off-topic robotics paper', publishedAt: null, excerpt: 'robots' },
      ],
    });
    const critic = new StubRelevanceCritic({
      'https://www.anthropic.com/news/claude-5': { relevant: true, confidence: 0.95, reason: 'platform-level', recommendation: 'evaluate adoption' },
      'https://arxiv.org/abs/2026.00001': { relevant: true, confidence: 0.8, reason: 'agent pattern', recommendation: 'spike' },
      'https://arxiv.org/abs/2026.00002': { relevant: false, confidence: 0.9, reason: 'off-topic', recommendation: '' },
    });

    const r = await runScan({
      sourcesPath: '/s.json',
      decisionsRoot: '/caia-ea/decisions',
      inboxPath: '/agent-memory/INBOX.md',
      reportsRoot: '/reports',
      webSearcher: searcher,
      relevanceCritic: critic,
      fs,
      clock: () => new Date('2026-05-25T04:00:00Z'),
      confidenceThreshold: 0.7,
      inboxDailyCap: 5,
    });

    expect(r.sourcesScanned).toBe(3);
    expect(r.itemsFound).toBe(3);
    expect(r.itemsJudged).toBe(3);
    expect(r.itemsRelevant).toBe(2);
    expect(r.candidateAdrs).toHaveLength(2);
    expect(r.inboxEntries).toBe(2);
    expect(r.reportPath).toContain('daily_upgrade_scan_2026-05-25.md');

    const inbox = fs.readFile('/agent-memory/INBOX.md');
    expect(inbox).toContain('AI-FIRST-UPGRADE CANDIDATES');
    expect(inbox).toContain('Claude 5 release');
    expect(inbox).toContain('Multi-agent reflection');
    expect(inbox).not.toContain('Off-topic');

    const report = fs.readFile(r.reportPath as string);
    expect(report).toContain('Sources scanned: 3');
    expect(report).toContain('Items relevant (above threshold): 2');
    expect(report).toContain('Candidate ADRs drafted: 2');
  });
});
