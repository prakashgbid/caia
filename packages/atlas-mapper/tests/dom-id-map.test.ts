import { describe, expect, it } from 'vitest';
import { assignStableDomIds } from '../src/assign-stable-dom-ids.js';
import { buildDomIdMap } from '../src/dom-id-map.js';
import { AtlasMapperError } from '../src/errors.js';
import { HOME_DOM_IDS, smallDesign } from './fixtures.js';

describe('buildDomIdMap', () => {
  it('emits one entry per node in depth-first pre-order', () => {
    const map = buildDomIdMap(assignStableDomIds(smallDesign()));
    // 11 home + 4 about = 15 entries.
    expect(map.entries.length).toBe(15);
    // The first entry is the home root (alphabetical route order: /, /about).
    expect(map.entries[0]?.domId).toBe(HOME_DOM_IDS.page);
    // The second is the home's first child (nav).
    expect(map.entries[1]?.domId).toBe(HOME_DOM_IDS.nav);
  });

  it('byId is a working O(1) index', () => {
    const map = buildDomIdMap(assignStableDomIds(smallDesign()));
    const entry = map.byId.get(HOME_DOM_IDS.hero);
    expect(entry).toBeDefined();
    expect(entry?.tag).toBe('HomeHeroSlider');
    expect(entry?.role).toBe('widget');
  });

  it('records ancestry inclusive of the node itself', () => {
    const map = buildDomIdMap(assignStableDomIds(smallDesign()));
    const slide = map.byId.get(HOME_DOM_IDS.heroSlide1)!;
    expect(slide.ancestry).toEqual([HOME_DOM_IDS.page, HOME_DOM_IDS.hero, HOME_DOM_IDS.heroSlide1]);
  });

  it('records parentDomId / position correctly', () => {
    const map = buildDomIdMap(assignStableDomIds(smallDesign()));
    const slide2 = map.byId.get(HOME_DOM_IDS.heroSlide2)!;
    expect(slide2.parentDomId).toBe(HOME_DOM_IDS.hero);
    expect(slide2.position).toBe(1);
  });

  it('shallow-clones attrs so the entry is independent of input', () => {
    const stabilised = assignStableDomIds(smallDesign());
    const map = buildDomIdMap(stabilised);
    const entry = map.byId.get(HOME_DOM_IDS.page)!;
    expect(entry.attrs).toEqual({ className: 'pt' });
    entry.attrs.foo = 'bar';
    expect(stabilised.componentTrees['tree:home']!.node.attrs).toEqual({ className: 'pt' });
  });

  it('throws unknown_component_tree on route referencing missing tree', () => {
    try {
      buildDomIdMap({
        designVersionId: 'dv_x',
        routes: [{ path: '/', componentTreeId: 'missing' }],
        componentTrees: {},
      });
      expect.fail('expected throw');
    } catch (e) {
      expect((e as AtlasMapperError).code).toBe('unknown_component_tree');
    }
  });

  it('throws duplicate_dom_id when two trees end up with same id', () => {
    try {
      buildDomIdMap({
        designVersionId: 'dv_x',
        routes: [
          { path: '/', componentTreeId: 't1' },
          { path: '/a', componentTreeId: 't2' },
        ],
        // Both roots derive the same id `div:page:0` — guaranteed collision.
        componentTrees: {
          t1: { node: { tag: 'div', role: 'page' } },
          t2: { node: { tag: 'div', role: 'page' } },
        },
      });
      expect.fail('expected throw');
    } catch (e) {
      expect((e as AtlasMapperError).code).toBe('duplicate_dom_id');
    }
  });

  it('walks each component tree referenced by routes exactly once', () => {
    // Two routes pointing at the same tree → tree walked once.
    const map = buildDomIdMap({
      designVersionId: 'dv_x',
      routes: [
        { path: '/', componentTreeId: 'shared' },
        { path: '/dup', componentTreeId: 'shared' },
      ],
      componentTrees: {
        shared: { node: { tag: 'div', role: 'page', children: [{ tag: 'p', role: 'leaf' }] } },
      },
    });
    expect(map.entries.length).toBe(2);
  });

  it('includes trees not referenced by any route', () => {
    const map = buildDomIdMap({
      designVersionId: 'dv_x',
      routes: [],
      componentTrees: {
        orphan: { node: { tag: 'Orphan', role: 'page' } },
      },
    });
    expect(map.byId.has('orphan:page:0')).toBe(true);
  });

  it('preserves a stable order across runs (determinism on entries)', () => {
    const stabilised = assignStableDomIds(smallDesign());
    const a = buildDomIdMap(stabilised).entries.map((e) => e.domId);
    const b = buildDomIdMap(stabilised).entries.map((e) => e.domId);
    expect(a).toEqual(b);
  });

  it('stores designVersionId on the output for downstream sanity checks', () => {
    const map = buildDomIdMap(assignStableDomIds(smallDesign('dv_xyz')));
    expect(map.designVersionId).toBe('dv_xyz');
  });
});
