import { describe, expect, it } from 'vitest';
import { draftCandidateAdrs, renderCandidate, slugify } from '../src/candidate-adr-drafter.js';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';
import type { JudgedItem } from '../src/types.js';

const j = (url: string, title: string): JudgedItem => ({
  item: { sourceId: 'src', url, title, publishedAt: null, excerpt: 'hello' },
  verdict: { relevant: true, confidence: 0.85, reason: 'good', recommendation: 'do x' },
});

describe('slugify', () => {
  it('lowercases and dasherises', () => {
    expect(slugify('Hello World 2026')).toBe('hello-world-2026');
  });

  it('returns "untitled" for empty input', () => {
    expect(slugify('')).toBe('untitled');
  });

  it('truncates to 80 chars', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe('renderCandidate', () => {
  it('includes header status proposed-by-daily-upgrade-cron', () => {
    const out = renderCandidate(j('http://x', 'Foo'), '2026-05-25');
    expect(out).toContain('Proposed-by-daily-upgrade-cron');
    expect(out).toContain('Foo');
    expect(out).toContain('Confidence');
  });
});

describe('draftCandidateAdrs', () => {
  it('writes a file per relevant item', () => {
    const fs = makeMemoryFsAdapter({});
    const out = draftCandidateAdrs({ judged: [j('http://x', 'Hello World')], decisionsRoot: '/d', fs, now: new Date('2026-05-25T10:00:00Z') });
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts[0]?.filePath).toContain('candidate-2026-05-25-hello-world.md');
    expect(fs.exists(out.drafts[0]?.filePath ?? '')).toBe(true);
  });

  it('survives a file-write error and records draft-error', () => {
    const fs = makeMemoryFsAdapter({});
    const broken = { ...fs, writeFile() { throw new Error('disk full'); }, exists: fs.exists, mkdirp: fs.mkdirp };
    const out = draftCandidateAdrs({ judged: [j('http://x', 'Title')], decisionsRoot: '/d', fs: broken as typeof fs, now: new Date('2026-05-25T10:00:00Z') });
    expect(out.drafts).toEqual([]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]?.kind).toBe('draft-error');
  });

  it('produces zero drafts for empty input', () => {
    const fs = makeMemoryFsAdapter({});
    const out = draftCandidateAdrs({ judged: [], decisionsRoot: '/d', fs, now: new Date() });
    expect(out.drafts).toEqual([]);
  });
});
