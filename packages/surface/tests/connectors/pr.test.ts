import { describe, it, expect } from 'vitest';

import { createPrConnector } from '../../src/connectors/pr.js';
import { FakeGh } from '../__fixtures__/runners.js';

const NOW = '2026-05-09T12:00:00.000Z';
const SINCE = '2026-05-08T12:00:00.000Z';

function makeMergedJson() {
  return JSON.stringify([
    {
      number: 400,
      title: 'feat: code-reviewer Phase 1',
      state: 'MERGED',
      author: { login: 'prakashgbid' },
      mergedAt: '2026-05-09T01:00:00.000Z',
      createdAt: '2026-05-08T20:00:00.000Z',
      updatedAt: '2026-05-09T01:00:00.000Z',
      url: 'https://github.com/prakashgbid/caia/pull/400',
      labels: [{ name: 'agent' }, { name: 'auto-merge' }],
      isDraft: false,
      baseRefName: 'develop',
      headRefName: 'feat/code-reviewer-001'
    },
    {
      number: 100,
      title: 'old',
      state: 'MERGED',
      mergedAt: '2026-04-01T00:00:00.000Z',
      createdAt: '2026-03-31T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
      url: 'u',
      labels: [],
      isDraft: false
    }
  ]);
}

function makeOpenJson() {
  return JSON.stringify([
    {
      number: 410,
      title: 'wip: surface skeleton',
      state: 'OPEN',
      createdAt: '2026-05-09T10:00:00.000Z',
      updatedAt: '2026-05-09T10:30:00.000Z',
      url: 'https://github.com/prakashgbid/caia/pull/410',
      labels: [{ name: 'agent' }],
      isDraft: false,
      baseRefName: 'develop',
      headRefName: 'feat/surface-001-skeleton'
    },
    {
      number: 50,
      title: 'old open one',
      state: 'OPEN',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-15T00:00:00.000Z',
      url: 'u',
      labels: [],
      isDraft: false
    }
  ]);
}

describe('pr connector', () => {
  it('emits findings for merged PRs in window', async () => {
    const gh = new FakeGh()
      .on(args => args.includes('--state') && args.includes('merged'), makeMergedJson())
      .on(args => args.includes('--state') && args.includes('open'), makeOpenJson());

    const c = createPrConnector({ ghRepo: 'prakashgbid/caia', gh });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });

    const merged = r.findings.find(f => f.kind === 'pr-merged');
    expect(merged).toBeDefined();
    expect(merged?.title).toContain('PR #400 merged');
    expect(merged?.url).toBe('https://github.com/prakashgbid/caia/pull/400');
    expect(merged?.tags).toContain('label:agent');
    expect(merged?.tags).toContain('base:develop');
  });

  it('drops merged PRs older than --since', async () => {
    const gh = new FakeGh()
      .on(args => args.includes('--state') && args.includes('merged'), makeMergedJson())
      .on(args => args.includes('--state') && args.includes('open'), makeOpenJson());
    const c = createPrConnector({ ghRepo: 'prakashgbid/caia', gh });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.find(f => f.key === 'pr#100')).toBeUndefined();
  });

  it('classifies open PR opened in window as pr-opened', async () => {
    const gh = new FakeGh()
      .on(args => args.includes('--state') && args.includes('merged'), makeMergedJson())
      .on(args => args.includes('--state') && args.includes('open'), makeOpenJson());
    const c = createPrConnector({ ghRepo: 'prakashgbid/caia', gh });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    const f = r.findings.find(x => x.key === 'pr#410');
    expect(f?.kind).toBe('pr-opened');
  });

  it('classifies old open PR as pr-stale', async () => {
    const gh = new FakeGh()
      .on(args => args.includes('--state') && args.includes('merged'), makeMergedJson())
      .on(args => args.includes('--state') && args.includes('open'), makeOpenJson());
    const c = createPrConnector({ ghRepo: 'prakashgbid/caia', gh });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    const f = r.findings.find(x => x.key === 'pr#50');
    expect(f?.kind).toBe('pr-stale');
  });

  it('emits warning when gh fails for merged but still tries open', async () => {
    const gh = new FakeGh()
      .on(args => args.includes('--state') && args.includes('merged'), new Error('rate-limit'))
      .on(args => args.includes('--state') && args.includes('open'), makeOpenJson());
    const c = createPrConnector({ ghRepo: 'prakashgbid/caia', gh });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
    expect(r.warnings.some(w => w.includes('rate-limit'))).toBe(true);
    expect(r.findings.length).toBeGreaterThanOrEqual(1);
  });

  it('handles malformed gh json gracefully', async () => {
    const gh = new FakeGh()
      .on(args => args.includes('--state') && args.includes('merged'), 'not-json')
      .on(args => args.includes('--state') && args.includes('open'), '');
    const c = createPrConnector({ ghRepo: 'prakashgbid/caia', gh });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.length).toBe(0);
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('finding ids are stable across runs (deterministic)', async () => {
    const gh1 = new FakeGh()
      .on(args => args.includes('merged'), makeMergedJson())
      .on(args => args.includes('open'), makeOpenJson());
    const gh2 = new FakeGh()
      .on(args => args.includes('merged'), makeMergedJson())
      .on(args => args.includes('open'), makeOpenJson());
    const c1 = createPrConnector({ ghRepo: 'prakashgbid/caia', gh: gh1 });
    const c2 = createPrConnector({ ghRepo: 'prakashgbid/caia', gh: gh2 });
    const r1 = await c1.collect({ sinceIso: SINCE, untilIso: NOW });
    const r2 = await c2.collect({ sinceIso: SINCE, untilIso: NOW });
    const ids1 = r1.findings.map(f => f.id).sort();
    const ids2 = r2.findings.map(f => f.id).sort();
    expect(ids1).toEqual(ids2);
  });

  it('truncates long titles to ≤200 chars', async () => {
    const longTitle = 'x'.repeat(300);
    const json = JSON.stringify([{
      number: 1,
      title: longTitle,
      state: 'MERGED',
      mergedAt: '2026-05-09T01:00:00.000Z',
      url: 'u',
      labels: [],
      isDraft: false
    }]);
    const gh = new FakeGh()
      .on(args => args.includes('merged'), json)
      .on(args => args.includes('open'), '[]');
    const c = createPrConnector({ ghRepo: 'r/r', gh });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings[0]?.title.length ?? 0).toBeLessThanOrEqual(220);
  });

  it('returns empty findings + warning when both gh calls fail', async () => {
    const gh = new FakeGh()
      .on(_ => true, new Error('gh not installed'));
    const c = createPrConnector({ ghRepo: 'r/r', gh });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.length).toBe(0);
    expect(r.warnings.length).toBe(2);
  });

  it('passes the configured limit to gh', async () => {
    let captured: string[] = [];
    const gh = new FakeGh().on(args => {
      captured = [...args];
      return true;
    }, '[]');
    const c = createPrConnector({ ghRepo: 'r/r', gh, limit: 25 });
    await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(captured).toContain('--limit');
    const idx = captured.indexOf('--limit');
    expect(captured[idx + 1]).toBe('25');
  });
});
