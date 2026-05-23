/**
 * Determinism + survival tests — the two non-negotiable properties of
 * `assignStableDomIds` per the task spec.
 *
 * "Determinism": same `RenderableDesign` → same DOM-IDs, byte-for-byte.
 *
 * "Survival": IDs survive style + copy + asset changes; flip on
 *  structural changes.
 */

import { describe, expect, it } from 'vitest';
import { assignStableDomIds } from '../src/assign-stable-dom-ids.js';
import { buildDomIdMap } from '../src/dom-id-map.js';
import { diff } from '../src/diff.js';
import {
  HOME_DOM_IDS,
  smallDesign,
  smallDesignStructural,
  smallDesignStyleOnly,
} from './fixtures.js';

describe('determinism', () => {
  it('two assignments of the same input produce identical output', () => {
    const a = assignStableDomIds(smallDesign());
    const b = assignStableDomIds(smallDesign());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('two map builds produce identical entries arrays', () => {
    const stabilised = assignStableDomIds(smallDesign());
    const a = buildDomIdMap(stabilised);
    const b = buildDomIdMap(stabilised);
    expect(a.entries.map((e) => e.domId)).toEqual(b.entries.map((e) => e.domId));
  });

  it('shuffling input route order does not change the output map', () => {
    const original = smallDesign();
    const reordered = {
      ...original,
      routes: [...original.routes].reverse(),
    };
    const a = buildDomIdMap(assignStableDomIds(original));
    const b = buildDomIdMap(assignStableDomIds(reordered));
    expect(a.entries.map((e) => e.domId)).toEqual(b.entries.map((e) => e.domId));
  });
});

describe('survival — style / copy / asset changes keep IDs', () => {
  it('changing className on a node does NOT change its domId', () => {
    const v1 = assignStableDomIds(smallDesign());
    const v2 = assignStableDomIds(smallDesignStyleOnly());
    const idsV1 = new Set(buildDomIdMap(v1).byId.keys());
    const idsV2 = new Set(buildDomIdMap(v2).byId.keys());
    // smallDesignStyleOnly differs ONLY in className + copy text. All
    // IDs from v1 must survive into v2.
    for (const id of idsV1) {
      expect(idsV2.has(id)).toBe(true);
    }
  });

  it('changing copy text does NOT change any domId', () => {
    const v1 = assignStableDomIds(smallDesign());
    const v2 = assignStableDomIds(smallDesignStyleOnly());
    const dr = diff(v1, v2);
    // Zero added, zero removed — pure modified.
    expect(dr.summary.added).toBe(0);
    expect(dr.summary.removed).toBe(0);
  });

  it('changing asset content-hash does NOT change any domId', () => {
    const base = {
      designVersionId: 'va',
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
      assets: [{ path: '/foo.png', contentHash: 'old' }],
    };
    const v1 = assignStableDomIds(base);
    const v2 = assignStableDomIds({
      ...base,
      designVersionId: 'vb',
      assets: [{ path: '/foo.png', contentHash: 'new' }],
    });
    const id1 = v1.componentTrees.t!.node.domId!;
    const id2 = v2.componentTrees.t!.node.domId!;
    expect(id1).toBe(id2);
  });

  it('changing resolved tokens does NOT change any domId', () => {
    const v1 = assignStableDomIds({
      designVersionId: 'va',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'X',
            role: 'page',
            resolvedStyle: { color: '#1e2a35' },
          },
        },
      },
    });
    const v2 = assignStableDomIds({
      designVersionId: 'vb',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'X',
            role: 'page',
            resolvedStyle: { color: '#000' },
          },
        },
      },
    });
    expect(v1.componentTrees.t!.node.domId).toBe(v2.componentTrees.t!.node.domId);
  });
});

describe('survival — structural changes DO change IDs', () => {
  it('removing a sibling shifts subsequent siblings to new IDs', () => {
    const v1 = assignStableDomIds(smallDesign());
    const v2 = assignStableDomIds(smallDesignStructural());
    const v1ids = new Set(buildDomIdMap(v1).byId.keys());
    const v2ids = new Set(buildDomIdMap(v2).byId.keys());
    // slide-2 was at position 1 in v1; gone in v2. Its ID disappears.
    expect(v1ids.has(HOME_DOM_IDS.heroSlide2)).toBe(true);
    expect(v2ids.has(HOME_DOM_IDS.heroSlide2)).toBe(false);
  });

  it('adding a new child appends new IDs without disturbing siblings before it', () => {
    const v1 = assignStableDomIds(smallDesign());
    const v2 = assignStableDomIds(smallDesignStructural());
    const v2ids = new Set(buildDomIdMap(v2).byId.keys());
    // Original three anchors keep their IDs.
    expect(v2ids.has(HOME_DOM_IDS.link0)).toBe(true);
    expect(v2ids.has(HOME_DOM_IDS.link1)).toBe(true);
    expect(v2ids.has(HOME_DOM_IDS.link2)).toBe(true);
    // New anchor at position 3.
    const newLink = `${HOME_DOM_IDS.grid}>a:leaf:3`;
    expect(v2ids.has(newLink)).toBe(true);
    void v1; // ensure v1 reference doesn't trip unused-var
  });

  it('reparenting a node shifts its DOM-ID (id includes parent path)', () => {
    // Move a child from parent A to parent B; same tag/role/position,
    // different parent path → different fingerprint.
    const a = assignStableDomIds({
      designVersionId: 'va',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'Root',
            role: 'page',
            children: [
              { tag: 'A', role: 'section', children: [{ tag: 'C', role: 'leaf' }] },
              { tag: 'B', role: 'section' },
            ],
          },
        },
      },
    });
    const b = assignStableDomIds({
      designVersionId: 'vb',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'Root',
            role: 'page',
            children: [
              { tag: 'A', role: 'section' },
              { tag: 'B', role: 'section', children: [{ tag: 'C', role: 'leaf' }] },
            ],
          },
        },
      },
    });
    const aC = buildDomIdMap(a)
      .entries.find((e) => e.tag === 'C')!
      .domId;
    const bC = buildDomIdMap(b)
      .entries.find((e) => e.tag === 'C')!
      .domId;
    expect(aC).not.toBe(bC);
  });

  it('renaming a component (tag change) flips its DOM-ID', () => {
    const a = assignStableDomIds({
      designVersionId: 'va',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: { node: { tag: 'WorkedWithWall', role: 'widget' } },
      },
    });
    const b = assignStableDomIds({
      designVersionId: 'vb',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: { node: { tag: 'LogoWall', role: 'widget' } },
      },
    });
    expect(a.componentTrees.t!.node.domId).toBe('worked-with-wall:widget:0');
    expect(b.componentTrees.t!.node.domId).toBe('logo-wall:widget:0');
    // Renames surface as remove+add per spec §2.3.
    const dr = diff(a, b);
    expect(dr.summary.added).toBe(1);
    expect(dr.summary.removed).toBe(1);
  });

  it('a re-walk after a no-op recompose returns identical IDs', () => {
    // Round-trip stress: stabilise, JSON-roundtrip, re-stabilise. We
    // compare DOM-ID sets (and per-entry tag/role/parent) rather than
    // raw JSON strings — JS object key insertion order differs between
    // the two passes (re-stabilise sets `domId` after the other fields)
    // but the structure they encode is identical, which is what the
    // contract guarantees.
    const v1 = assignStableDomIds(smallDesign());
    const json = JSON.parse(JSON.stringify(v1));
    const v2 = assignStableDomIds(json);
    const m1 = buildDomIdMap(v1);
    const m2 = buildDomIdMap(v2);
    expect([...m1.byId.keys()].sort()).toEqual([...m2.byId.keys()].sort());
    for (const id of m1.byId.keys()) {
      const a = m1.byId.get(id)!;
      const b = m2.byId.get(id)!;
      expect(b.tag).toBe(a.tag);
      expect(b.role).toBe(a.role);
      expect(b.parentDomId).toBe(a.parentDomId);
      expect(b.position).toBe(a.position);
    }
  });
});
