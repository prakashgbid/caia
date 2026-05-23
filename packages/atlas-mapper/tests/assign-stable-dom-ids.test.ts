import { describe, expect, it } from 'vitest';
import { assignStableDomIds } from '../src/assign-stable-dom-ids.js';
import { AtlasMapperError } from '../src/errors.js';
import { ABOUT_DOM_IDS, HOME_DOM_IDS, smallDesign } from './fixtures.js';

describe('assignStableDomIds', () => {
  it('produces the expected derived DOM-IDs on the home tree', () => {
    const stabilised = assignStableDomIds(smallDesign());
    const home = stabilised.componentTrees['tree:home']!;
    expect(home.node.domId).toBe(HOME_DOM_IDS.page);
    expect(home.node.children?.[0]?.domId).toBe(HOME_DOM_IDS.nav);
    expect(home.node.children?.[1]?.domId).toBe(HOME_DOM_IDS.hero);
    expect(home.node.children?.[1]?.children?.[0]?.domId).toBe(HOME_DOM_IDS.heroSlide1);
    expect(home.node.children?.[1]?.children?.[1]?.domId).toBe(HOME_DOM_IDS.heroSlide2);
    expect(home.node.children?.[2]?.domId).toBe(HOME_DOM_IDS.section);
  });

  it('produces distinct IDs for the about tree (no cross-tree collision)', () => {
    const stabilised = assignStableDomIds(smallDesign());
    const about = stabilised.componentTrees['tree:about']!;
    expect(about.node.domId).toBe(ABOUT_DOM_IDS.page);
    expect(about.node.children?.[0]?.domId).toBe(ABOUT_DOM_IDS.nav);
    expect(about.node.children?.[1]?.domId).toBe(ABOUT_DOM_IDS.section);
  });

  it('preserves adapter-supplied domIds verbatim', () => {
    const stabilised = assignStableDomIds({
      designVersionId: 'dv_x',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'div',
            role: 'page',
            domId: 'PG-explicit',
            children: [{ tag: 'span', role: 'leaf', domId: 'WD-explicit' }],
          },
        },
      },
    });
    expect(stabilised.componentTrees.t!.node.domId).toBe('PG-explicit');
    expect(stabilised.componentTrees.t!.node.children?.[0]?.domId).toBe('WD-explicit');
  });

  it('does not mutate the input design', () => {
    const input = smallDesign();
    const before = JSON.stringify(input);
    assignStableDomIds(input);
    const after = JSON.stringify(input);
    expect(after).toBe(before);
    // Specifically: input nodes still have no domId.
    expect(input.componentTrees['tree:home']!.node.domId).toBeUndefined();
  });

  it('handles a fingerprint that mixes adapter IDs and derived IDs', () => {
    const stabilised = assignStableDomIds({
      designVersionId: 'dv_x',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'div',
            role: 'page',
            domId: 'PG-mixed',
            children: [{ tag: 'span', role: 'leaf' }],
          },
        },
      },
    });
    expect(stabilised.componentTrees.t!.node.domId).toBe('PG-mixed');
    // Derived child's parent prefix is the adapter ID.
    expect(stabilised.componentTrees.t!.node.children?.[0]?.domId).toBe('PG-mixed>span:leaf:0');
  });

  it('throws cycle_detected on adapter IDs that recur on a path', () => {
    expect(() =>
      assignStableDomIds({
        designVersionId: 'dv_x',
        routes: [{ path: '/', componentTreeId: 't' }],
        componentTrees: {
          t: {
            node: {
              tag: 'div',
              role: 'page',
              domId: 'A',
              children: [
                {
                  tag: 'div',
                  role: 'leaf',
                  domId: 'B',
                  children: [{ tag: 'div', role: 'leaf', domId: 'A' }],
                },
              ],
            },
          },
        },
      }),
    ).toThrowError(AtlasMapperError);
  });

  it('throws duplicate_dom_id on adapter-supplied collisions across siblings', () => {
    try {
      assignStableDomIds({
        designVersionId: 'dv_x',
        routes: [{ path: '/', componentTreeId: 't' }],
        componentTrees: {
          t: {
            node: {
              tag: 'div',
              role: 'page',
              children: [
                { tag: 'a', role: 'leaf', domId: 'DUP' },
                { tag: 'b', role: 'leaf', domId: 'DUP' },
              ],
            },
          },
        },
      });
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AtlasMapperError);
      expect((e as AtlasMapperError).code).toBe('duplicate_dom_id');
    }
  });

  it('throws invalid_renderable_design on missing designVersionId', () => {
    expect(() =>
      assignStableDomIds({
        designVersionId: '',
        routes: [],
        componentTrees: {},
      }),
    ).toThrowError(/designVersionId/);
  });

  it('throws unknown_component_tree on route referencing missing tree', () => {
    try {
      assignStableDomIds({
        designVersionId: 'dv_x',
        routes: [{ path: '/', componentTreeId: 'missing' }],
        componentTrees: {},
      });
      expect.fail('expected throw');
    } catch (e) {
      expect((e as AtlasMapperError).code).toBe('unknown_component_tree');
    }
  });

  it('walks shared components after route trees', () => {
    const stabilised = assignStableDomIds({
      designVersionId: 'dv_x',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: { node: { tag: 'HomePage', role: 'page' } },
      },
      sharedComponents: [
        {
          id: 'monogram',
          node: { tag: 'Monogram', role: 'widget', children: [{ tag: 'svg', role: 'leaf' }] },
        },
      ],
    });
    expect(stabilised.sharedComponents?.[0]?.node.domId).toBe('monogram:widget:0');
    expect(stabilised.sharedComponents?.[0]?.node.children?.[0]?.domId).toBe(
      'monogram:widget:0>svg:leaf:0',
    );
  });

  it('passes through pass-through fields unchanged', () => {
    const input = smallDesign();
    input.tenantId = 'tnt_x';
    input.uploadedAt = '2026-05-23T16:00:00Z';
    const stabilised = assignStableDomIds(input);
    expect(stabilised.tenantId).toBe('tnt_x');
    expect(stabilised.uploadedAt).toBe('2026-05-23T16:00:00Z');
  });
});
