import { describe, it, expect } from 'vitest';
import {
  buildDomIdMap,
  AtlasMapperError,
  type RenderableDesign,
} from '../src/index.js';
import { simpleHomeDesign, leaf, container } from './fixtures.js';

describe('buildDomIdMap — happy path', () => {
  it('emits the expected DOM-ID entries for the simple home fixture', () => {
    const map = buildDomIdMap(simpleHomeDesign());
    const ids = map.entries.map((e) => e.domId);
    expect(ids).toEqual([
      'PG-home',
      'SE-home-hero',
      'WD-home-hero-rotator',
      'WD-home-hero-cta',
      'WD-home-hero-headline',
      'WD-home-hero-image',
      'SE-home-footer',
      'WD-home-footer-copyright',
    ]);
  });

  it('exposes a byId index in O(1) for every emitted entry', () => {
    const map = buildDomIdMap(simpleHomeDesign());
    for (const e of map.entries) {
      expect(map.byId.get(e.domId)).toBe(e);
    }
  });

  it('sets parentDomId to null for tree roots and to the parent id elsewhere', () => {
    const map = buildDomIdMap(simpleHomeDesign());
    const root = map.byId.get('PG-home');
    const hero = map.byId.get('SE-home-hero');
    const cta = map.byId.get('WD-home-hero-cta');
    expect(root?.parentDomId).toBeNull();
    expect(hero?.parentDomId).toBe('PG-home');
    expect(cta?.parentDomId).toBe('WD-home-hero-rotator');
  });

  it('populates ancestry inclusive of the node itself, root-first', () => {
    const map = buildDomIdMap(simpleHomeDesign());
    const cta = map.byId.get('WD-home-hero-cta');
    expect(cta?.ancestry).toEqual([
      'PG-home',
      'SE-home-hero',
      'WD-home-hero-rotator',
      'WD-home-hero-cta',
    ]);
  });

  it('records sibling position correctly under each parent', () => {
    const map = buildDomIdMap(simpleHomeDesign());
    expect(map.byId.get('SE-home-hero')?.position).toBe(0);
    expect(map.byId.get('SE-home-footer')?.position).toBe(1);
    expect(map.byId.get('WD-home-hero-rotator')?.position).toBe(0);
    expect(map.byId.get('WD-home-hero-image')?.position).toBe(1);
    expect(map.byId.get('WD-home-hero-cta')?.position).toBe(0);
    expect(map.byId.get('WD-home-hero-headline')?.position).toBe(1);
  });

  it('clones attrs so input mutation cannot affect the emitted entry', () => {
    const design = simpleHomeDesign();
    const map = buildDomIdMap(design);
    const heroIn = design.componentTrees['tree:home']!.node.children![0]!;
    const heroOut = map.byId.get('SE-home-hero')!;
    (heroIn.attrs as Record<string, unknown>)['mutated'] = true;
    expect(heroOut.attrs['mutated']).toBeUndefined();
  });

  it('passes through copyRefs, assetRefs, and resolvedStyle verbatim', () => {
    const map = buildDomIdMap(simpleHomeDesign());
    const headline = map.byId.get('WD-home-hero-headline');
    const image = map.byId.get('WD-home-hero-image');
    expect(headline?.copyRefs).toEqual(['copy:headline']);
    expect(headline?.resolvedStyle).toEqual({
      fontFamily: 'Source Serif Pro',
      color: '#1e2a35',
    });
    expect(image?.assetRefs).toEqual(['/headshot.jpg']);
  });

  it('echoes designVersionId on the output map', () => {
    const map = buildDomIdMap(simpleHomeDesign({ designVersionId: 'dv_test_xyz' }));
    expect(map.designVersionId).toBe('dv_test_xyz');
  });

  it('records componentTreeId for every entry', () => {
    const map = buildDomIdMap(simpleHomeDesign());
    for (const e of map.entries) {
      expect(e.componentTreeId).toBe('tree:home');
    }
  });
});

describe('buildDomIdMap — derived IDs', () => {
  function withoutAdapterIds(): RenderableDesign {
    // No adapter-supplied IDs: derive everything from structure.
    return {
      designVersionId: 'dv_no_ids',
      routes: [{ path: '/', componentTreeId: 'tree:home' }],
      componentTrees: {
        'tree:home': {
          node: container(
            'main',
            'page',
            [
              container('section', 'section', [
                leaf('h1', { role: 'leaf' }),
                leaf('p', { role: 'leaf' }),
              ]),
              container('section', 'section', [leaf('button', { role: 'leaf' })]),
            ],
          ),
        },
      },
    };
  }

  it('derives IDs deterministically from tag + role + position', () => {
    const map = buildDomIdMap(withoutAdapterIds());
    expect(map.entries.map((e) => e.domId)).toEqual([
      'main:page:0',
      'main:page:0>section:section:0',
      'main:page:0>section:section:0>h1:leaf:0',
      'main:page:0>section:section:0>p:leaf:1',
      'main:page:0>section:section:1',
      'main:page:0>section:section:1>button:leaf:0',
    ]);
  });

  it('handles PascalCase component names via kebab-case slug', () => {
    const design: RenderableDesign = {
      designVersionId: 'dv_pascal',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: container('HomeHeroSlider', 'page', [
            leaf('CTAButton', { role: 'leaf' }),
          ]),
        },
      },
    };
    const map = buildDomIdMap(design);
    expect(map.entries.map((e) => e.domId)).toEqual([
      'home-hero-slider:page:0',
      'home-hero-slider:page:0>cta-button:leaf:0',
    ]);
  });

  it('prefers adapter-supplied IDs over derived ones even when mixed', () => {
    const design: RenderableDesign = {
      designVersionId: 'dv_mixed',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: container(
            'main',
            'page',
            [
              leaf('button', { role: 'leaf', domId: 'WD-explicit-btn' }),
              leaf('span', { role: 'leaf' }),
            ],
            { domId: 'PG-explicit-root' },
          ),
        },
      },
    };
    const map = buildDomIdMap(design);
    expect(map.entries.map((e) => e.domId)).toEqual([
      'PG-explicit-root',
      'WD-explicit-btn',
      'PG-explicit-root>span:leaf:1',
    ]);
  });

  it('handles angle-bracketed tag forms like <HomeHero>', () => {
    const design: RenderableDesign = {
      designVersionId: 'dv_brackets',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: { node: leaf('<HomeHero>', { role: 'page' }) },
      },
    };
    const map = buildDomIdMap(design);
    expect(map.entries[0]?.domId).toBe('home-hero:page:0');
  });
});

describe('buildDomIdMap — error handling', () => {
  it('throws invalid_renderable_design on null input', () => {
    expect(() => buildDomIdMap(null as unknown as RenderableDesign)).toThrow(
      AtlasMapperError,
    );
  });

  it('throws when designVersionId is missing', () => {
    expect(() =>
      buildDomIdMap({
        designVersionId: '',
        routes: [],
        componentTrees: {},
      } as unknown as RenderableDesign),
    ).toThrow(/designVersionId/);
  });

  it('throws when componentTrees is not an object', () => {
    expect(() =>
      buildDomIdMap({
        designVersionId: 'x',
        routes: [],
      } as unknown as RenderableDesign),
    ).toThrow(/componentTrees/);
  });

  it('throws when routes is not an array', () => {
    expect(() =>
      buildDomIdMap({
        designVersionId: 'x',
        routes: 'oops',
        componentTrees: {},
      } as unknown as RenderableDesign),
    ).toThrow(/routes/);
  });

  it('throws unknown_component_tree when a route points to a missing tree', () => {
    expect(() =>
      buildDomIdMap({
        designVersionId: 'x',
        routes: [{ path: '/', componentTreeId: 'tree:missing' }],
        componentTrees: {},
      }),
    ).toThrow(/unknown_component_tree|references unknown componentTreeId/);
  });

  it('throws cycle_detected when adapter-supplied IDs form a cycle', () => {
    // Synthesise a cycle by reusing the same explicit domId on a
    // descendant — the walker sees the same id appear twice on the
    // visit path.
    const root: import('../src/renderable-design.js').RenderableNode = {
      tag: 'main',
      role: 'page',
      domId: 'X',
    };
    const child: import('../src/renderable-design.js').RenderableNode = {
      tag: 'section',
      role: 'section',
      domId: 'X', // same id as parent → cycle
    };
    root.children = [child];

    expect(() =>
      buildDomIdMap({
        designVersionId: 'dv_cycle',
        routes: [{ path: '/', componentTreeId: 't' }],
        componentTrees: { t: { node: root } },
      }),
    ).toThrowError(/cycle_detected|already on the visit path/);
  });

  it('throws duplicate_dom_id when sibling nodes resolve to the same id', () => {
    // Two siblings, both with the same adapter-supplied domId.
    const design: RenderableDesign = {
      designVersionId: 'dv_dup',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: container(
            'main',
            'page',
            [
              leaf('button', { role: 'leaf', domId: 'WD-dup' }),
              leaf('button', { role: 'leaf', domId: 'WD-dup' }),
            ],
            { domId: 'PG-x' },
          ),
        },
      },
    };
    expect(() => buildDomIdMap(design)).toThrow(/duplicate_dom_id|Duplicate DOM-ID/);
  });
});

describe('buildDomIdMap — multi-route handling', () => {
  it('walks each component tree exactly once even when shared across routes', () => {
    const design: RenderableDesign = {
      designVersionId: 'dv_shared',
      routes: [
        { path: '/a', componentTreeId: 't:shared' },
        { path: '/b', componentTreeId: 't:shared' },
      ],
      componentTrees: {
        't:shared': {
          node: leaf('main', { role: 'page', domId: 'PG-shared' }),
        },
      },
    };
    const map = buildDomIdMap(design);
    expect(map.entries.map((e) => e.domId)).toEqual(['PG-shared']);
  });

  it('walks all component trees referenced by routes, sorted by path', () => {
    const design: RenderableDesign = {
      designVersionId: 'dv_multi',
      routes: [
        { path: '/about', componentTreeId: 't:about' },
        { path: '/', componentTreeId: 't:home' },
      ],
      componentTrees: {
        't:home': { node: leaf('main', { role: 'page', domId: 'PG-home' }) },
        't:about': { node: leaf('main', { role: 'page', domId: 'PG-about' }) },
      },
    };
    const map = buildDomIdMap(design);
    // Routes sorted by path: '/' first, then '/about'.
    expect(map.entries.map((e) => e.domId)).toEqual(['PG-home', 'PG-about']);
  });

  it('walks orphan component trees (not referenced by any route)', () => {
    const design: RenderableDesign = {
      designVersionId: 'dv_orphan',
      routes: [],
      componentTrees: {
        't:orphan': { node: leaf('main', { role: 'page', domId: 'PG-orphan' }) },
      },
    };
    const map = buildDomIdMap(design);
    expect(map.entries.map((e) => e.domId)).toEqual(['PG-orphan']);
  });

  it('walks sharedComponents as their own component trees', () => {
    const design: RenderableDesign = {
      designVersionId: 'dv_shared',
      routes: [],
      componentTrees: {},
      sharedComponents: [
        {
          id: 'monogram',
          node: leaf('svg', { role: 'shared-ref', domId: 'shared-monogram' }),
        },
      ],
    };
    const map = buildDomIdMap(design);
    expect(map.entries.map((e) => e.domId)).toEqual(['shared-monogram']);
    expect(map.entries[0]?.componentTreeId).toBe('shared:monogram');
  });
});

describe('buildDomIdMap — empty / degenerate cases', () => {
  it('handles a design with no routes and no component trees', () => {
    const map = buildDomIdMap({
      designVersionId: 'dv_empty',
      routes: [],
      componentTrees: {},
    });
    expect(map.entries).toEqual([]);
    expect(map.byId.size).toBe(0);
  });

  it('handles a single-node tree with no children', () => {
    const map = buildDomIdMap({
      designVersionId: 'dv_single',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: { node: leaf('div', { role: 'page', domId: 'PG-only' }) },
      },
    });
    expect(map.entries).toHaveLength(1);
    expect(map.entries[0]?.domId).toBe('PG-only');
    expect(map.entries[0]?.parentDomId).toBeNull();
  });
});
