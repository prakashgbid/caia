import { describe, expect, it } from 'vitest';
import { assignStableDomIds } from '../src/assign-stable-dom-ids.js';
import { diff, diffMaps } from '../src/diff.js';
import { buildDomIdMap } from '../src/dom-id-map.js';
import {
  HOME_DOM_IDS,
  smallDesign,
  smallDesignStructural,
  smallDesignStyleOnly,
} from './fixtures.js';

describe('diff — added / removed / unchanged buckets', () => {
  it('reports zero changes when comparing a design with itself (clone)', () => {
    const d = assignStableDomIds(smallDesign());
    const dr = diff(d, d);
    expect(dr.summary.added).toBe(0);
    expect(dr.summary.removed).toBe(0);
    expect(dr.summary.modified).toBe(0);
    expect(dr.summary.unchanged).toBe(15);
  });

  it('reports added entries when v2 has more nodes', () => {
    const v1 = assignStableDomIds(smallDesign());
    const v2 = assignStableDomIds(smallDesignStructural());
    const dr = diff(v1, v2);
    expect(dr.summary.added).toBeGreaterThan(0);
    expect(dr.added.some((e) => e.attrs?.['data-go'] === '/speaking')).toBe(true);
  });

  it('reports removed entries when v2 has fewer nodes', () => {
    const v1 = assignStableDomIds(smallDesign());
    const v2 = assignStableDomIds(smallDesignStructural());
    const dr = diff(v1, v2);
    // v1 had slide-2; v2 removed it.
    expect(dr.removed.some((e) => e.attrs?.className === 'slide-2')).toBe(true);
  });

  it('flags attrs_changed when className changes', () => {
    const v1 = assignStableDomIds(smallDesign());
    const v2 = assignStableDomIds(smallDesignStyleOnly());
    const dr = diff(v1, v2);
    const pageEntry = dr.modified.find((e) => e.domId === HOME_DOM_IDS.page);
    expect(pageEntry?.reasons).toContain('attrs_changed');
  });

  it('flags copy_changed when copy[].text differs for a same domId', () => {
    const v1 = assignStableDomIds(smallDesign());
    const v2 = assignStableDomIds(smallDesignStyleOnly());
    const dr = diff(v1, v2);
    const h2 = dr.modified.find((e) => e.domId === HOME_DOM_IDS.h2);
    expect(h2?.reasons).toContain('copy_changed');
  });

  it('flags token_changed when only resolvedStyle differs', () => {
    const a = {
      designVersionId: 'va',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'X',
            role: 'page' as const,
            resolvedStyle: { color: '#1e2a35' },
          },
        },
      },
    };
    const b = {
      designVersionId: 'vb',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'X',
            role: 'page' as const,
            resolvedStyle: { color: '#000000' },
          },
        },
      },
    };
    const dr = diff(a, b);
    expect(dr.modified[0]?.reasons).toEqual(['token_changed']);
  });

  it('does not double-count token_changed when attrs already changed', () => {
    const a = {
      designVersionId: 'va',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'X',
            role: 'page' as const,
            attrs: { className: 'old' },
            resolvedStyle: { color: '#1e2a35' },
          },
        },
      },
    };
    const b = {
      designVersionId: 'vb',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'X',
            role: 'page' as const,
            attrs: { className: 'new' },
            resolvedStyle: { color: '#000000' },
          },
        },
      },
    };
    const dr = diff(a, b);
    expect(dr.modified[0]?.reasons).toEqual(['attrs_changed']);
    expect(dr.modified[0]?.reasons).not.toContain('token_changed');
  });

  it('flags asset_changed when contentHash differs', () => {
    const mkDesign = (hash: string) => ({
      designVersionId: 'v',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'X',
            role: 'page' as const,
            assetRefs: ['/foo.png'],
          },
        },
      },
      assets: [{ path: '/foo.png', contentHash: hash, kind: 'image' as const }],
    });
    const dr = diff(mkDesign('aaa'), mkDesign('bbb'));
    expect(dr.modified[0]?.reasons).toEqual(['asset_changed']);
  });

  it('does NOT flag asset_changed when content-hash matches even if alt differs', () => {
    const mk = (alt: string) => ({
      designVersionId: 'v',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'X',
            role: 'page' as const,
            assetRefs: ['/foo.png'],
          },
        },
      },
      assets: [{ path: '/foo.png', contentHash: 'same', kind: 'image', alt }],
    });
    const dr = diff(mk('Before'), mk('After'));
    expect(dr.summary.modified).toBe(0);
  });

  it('keeps the output deterministic across runs', () => {
    const v1 = assignStableDomIds(smallDesign());
    const v2 = assignStableDomIds(smallDesignStructural());
    const a = diff(v1, v2);
    const b = diff(v1, v2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('sorts added / removed / modified by domId lex', () => {
    const v1 = assignStableDomIds(smallDesign());
    const v2 = assignStableDomIds(smallDesignStructural());
    const dr = diff(v1, v2);
    const ids = dr.added.map((e) => e.domId);
    expect(ids).toEqual([...ids].sort());
  });

  it('records fromDesignVersionId / toDesignVersionId in the result', () => {
    const v1 = assignStableDomIds(smallDesign('dv_v1'));
    const v2 = assignStableDomIds(smallDesignStyleOnly('dv_v2'));
    const dr = diff(v1, v2);
    expect(dr.fromDesignVersionId).toBe('dv_v1');
    expect(dr.toDesignVersionId).toBe('dv_v2');
  });

  it('diffMaps accepts pre-built maps and matches diff() output', () => {
    const v1 = assignStableDomIds(smallDesign());
    const v2 = assignStableDomIds(smallDesignStyleOnly());
    const a = diff(v1, v2);
    const b = diffMaps(buildDomIdMap(v1), buildDomIdMap(v2), v1, v2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
