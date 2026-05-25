import { describe, expect, it } from 'vitest';
import { NullRelevanceCritic, StubRelevanceCritic, filterItems } from '../src/relevance-filter.js';
import type { RelevanceCritic, SearchResult } from '../src/types.js';

const r = (url: string): SearchResult => ({ sourceId: 's', url, title: 't', publishedAt: null, excerpt: '' });

describe('NullRelevanceCritic', () => {
  it('returns relevant=false', async () => {
    const v = await new NullRelevanceCritic().judge(r('http://x'));
    expect(v.relevant).toBe(false);
  });
});

describe('StubRelevanceCritic', () => {
  it('returns canned verdict per url', async () => {
    const c = new StubRelevanceCritic({ 'http://x': { relevant: true, confidence: 0.9, reason: 'r', recommendation: 'go' } });
    expect((await c.judge(r('http://x'))).relevant).toBe(true);
  });

  it('falls back to relevant=false for unknown url', async () => {
    const c = new StubRelevanceCritic({});
    expect((await c.judge(r('http://y'))).relevant).toBe(false);
  });
});

describe('filterItems', () => {
  it('marks high-confidence items as relevant', async () => {
    const c = new StubRelevanceCritic({
      'http://a': { relevant: true, confidence: 0.9, reason: '', recommendation: '' },
      'http://b': { relevant: true, confidence: 0.5, reason: '', recommendation: '' },
      'http://c': { relevant: false, confidence: 0.95, reason: '', recommendation: '' },
    });
    const out = await filterItems({ items: [r('http://a'), r('http://b'), r('http://c')], critic: c, confidenceThreshold: 0.7 });
    expect(out.relevant).toHaveLength(1);
    expect(out.relevant[0]?.item.url).toBe('http://a');
    expect(out.judged).toHaveLength(3);
  });

  it('captures per-item judge errors', async () => {
    const bad: RelevanceCritic = {
      async judge(item) {
        if (item.url === 'http://b') throw new Error('boom');
        return { relevant: true, confidence: 0.9, reason: '', recommendation: '' };
      },
    };
    const out = await filterItems({ items: [r('http://a'), r('http://b')], critic: bad, confidenceThreshold: 0.7 });
    expect(out.relevant).toHaveLength(1);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]?.kind).toBe('judge-error');
  });

  it('returns empty for empty items', async () => {
    const out = await filterItems({ items: [], critic: new NullRelevanceCritic(), confidenceThreshold: 0.5 });
    expect(out.judged).toEqual([]);
  });

  it('respects confidence threshold edge', async () => {
    const c = new StubRelevanceCritic({ 'http://a': { relevant: true, confidence: 0.7, reason: '', recommendation: '' } });
    const out = await filterItems({ items: [r('http://a')], critic: c, confidenceThreshold: 0.7 });
    expect(out.relevant).toHaveLength(1);
  });
});
