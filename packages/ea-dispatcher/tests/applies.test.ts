import { describe, it, expect } from 'vitest';
import { partitionByApplies, selectByName } from '../src/applies.js';
import { MockArchitect, makeContract, stubTicket } from './fixtures.js';

describe('partitionByApplies', () => {
  it('passes architects whose predicate returns true', () => {
    const arch = new MockArchitect(
      'a',
      makeContract('a', ['a.x'], { appliesPredicate: () => true }),
    );
    const { applicable, skipped } = partitionByApplies([arch], stubTicket());
    expect(applicable.map((a) => a.name)).toEqual(['a']);
    expect(skipped).toEqual([]);
  });

  it('skips architects whose predicate returns false', () => {
    const arch = new MockArchitect(
      'a',
      makeContract('a', ['a.x'], { appliesPredicate: () => false }),
    );
    const { applicable, skipped } = partitionByApplies([arch], stubTicket());
    expect(applicable).toEqual([]);
    expect(skipped).toEqual(['a']);
  });

  it('treats a throwing predicate as skipped (defensive)', () => {
    const arch = new MockArchitect(
      'a',
      makeContract('a', ['a.x'], {
        appliesPredicate: () => {
          throw new Error('boom');
        },
      }),
    );
    const { applicable, skipped } = partitionByApplies([arch], stubTicket());
    expect(applicable).toEqual([]);
    expect(skipped).toEqual(['a']);
  });

  it('routes architects by ticket type', () => {
    const pageOnly = new MockArchitect(
      'pageOnly',
      makeContract('pageOnly', ['p.x'], { appliesPredicate: (t) => t.type === 'Page' }),
    );
    const widgetOnly = new MockArchitect(
      'widgetOnly',
      makeContract('widgetOnly', ['w.x'], { appliesPredicate: (t) => t.type === 'Widget' }),
    );
    const archs = [pageOnly, widgetOnly];

    const onPage = partitionByApplies(archs, stubTicket({ type: 'Page' }));
    expect(onPage.applicable.map((a) => a.name)).toEqual(['pageOnly']);
    expect(onPage.skipped).toEqual(['widgetOnly']);

    const onWidget = partitionByApplies(archs, stubTicket({ type: 'Widget' }));
    expect(onWidget.applicable.map((a) => a.name)).toEqual(['widgetOnly']);
  });

  it('routes architects by quality_tags (seo, a11y, performance)', () => {
    const seo = new MockArchitect(
      'seo',
      makeContract('seo', ['seo.title'], {
        appliesPredicate: (t) => (t.quality_tags ?? []).includes('seo'),
      }),
    );
    const seoTicket = stubTicket({ quality_tags: ['seo'] });
    const noSeo = stubTicket({ quality_tags: [] });
    expect(partitionByApplies([seo], seoTicket).applicable.length).toBe(1);
    expect(partitionByApplies([seo], noSeo).applicable.length).toBe(0);
  });
});

describe('selectByName', () => {
  const a = new MockArchitect('a', makeContract('a', ['a.x']));
  const b = new MockArchitect('b', makeContract('b', ['b.x']));
  const c = new MockArchitect('c', makeContract('c', ['c.x']));

  it('returns the named subset in input order', () => {
    expect(selectByName([a, b, c], ['c', 'a']).map((x) => x.name)).toEqual(['a', 'c']);
  });

  it('returns empty for an empty name list', () => {
    expect(selectByName([a, b, c], [])).toEqual([]);
  });

  it('ignores names not in the set', () => {
    expect(selectByName([a, b], ['ghost', 'b']).map((x) => x.name)).toEqual(['b']);
  });
});
