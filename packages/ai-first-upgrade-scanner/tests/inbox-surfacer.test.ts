import { describe, expect, it } from 'vitest';
import { surfaceCandidates } from '../src/inbox-surfacer.js';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';
import type { CandidateAdr, JudgedItem } from '../src/types.js';

const j = (url: string, title = 't'): JudgedItem => ({
  item: { sourceId: 's', url, title, publishedAt: null, excerpt: '' },
  verdict: { relevant: true, confidence: 0.9, reason: '', recommendation: '' },
});
const d = (slug: string): CandidateAdr => ({ slug, filePath: `/d/candidate-${slug}.md`, content: '' });

describe('surfaceCandidates', () => {
  const now = new Date('2026-05-25T10:00:00Z');

  it('returns zero entries for empty input', () => {
    const fs = makeMemoryFsAdapter({});
    const r = surfaceCandidates([], [], { inboxPath: '/i/INBOX.md', fs, now, dailyCap: 5 });
    expect(r.newEntries).toBe(0);
  });

  it('writes new INBOX section with up to dailyCap items', () => {
    const fs = makeMemoryFsAdapter({});
    const items = [j('http://a'), j('http://b'), j('http://c'), j('http://d'), j('http://e'), j('http://f')];
    const drafts = items.map((_, i) => d(`slug-${i}`));
    const r = surfaceCandidates(items, drafts, { inboxPath: '/i/INBOX.md', fs, now, dailyCap: 5 });
    expect(r.newEntries).toBe(5);
    expect(r.cappedOut).toBe(1);
    const c = fs.readFile('/i/INBOX.md');
    expect(c).toContain('## 2026-05-25 — AI-FIRST-UPGRADE CANDIDATES');
  });

  it('dedups items seen in INBOX within window', () => {
    const fs = makeMemoryFsAdapter({
      '/i/INBOX.md': '## 2026-05-20 — AI-FIRST-UPGRADE CANDIDATES\n\n- [t](http://a) — confidence 0.90\n\n',
    });
    const r = surfaceCandidates([j('http://a')], [d('a')], { inboxPath: '/i/INBOX.md', fs, now, dailyCap: 5 });
    expect(r.newEntries).toBe(0);
    expect(r.dedupedEntries).toBe(1);
  });

  it('outside-window dedups do not apply', () => {
    const fs = makeMemoryFsAdapter({
      '/i/INBOX.md': '## 2025-01-01 — AI-FIRST-UPGRADE CANDIDATES\n\n- [t](http://a) — confidence 0.90\n\n',
    });
    const r = surfaceCandidates([j('http://a')], [d('a')], { inboxPath: '/i/INBOX.md', fs, now, dailyCap: 5 });
    expect(r.newEntries).toBe(1);
  });

  it('survives malformed date header', () => {
    const fs = makeMemoryFsAdapter({
      '/i/INBOX.md': '## not-a-date — AI-FIRST-UPGRADE CANDIDATES\n\n- [t](http://a) — confidence 0.90\n\n',
    });
    const r = surfaceCandidates([j('http://a')], [d('a')], { inboxPath: '/i/INBOX.md', fs, now, dailyCap: 5 });
    expect(r.newEntries).toBe(1);
  });
});
