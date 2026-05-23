import { describe, it, expect } from 'vitest';
import { buildDomIdMap } from '../src/index.js';
import {
  simpleHomeDesign,
  modifyHomeForV2,
} from './fixtures.js';

/**
 * Strip the byId Map (Map equality bites otherwise) before doing
 * deep-equality. Map order is iteration order in JS, which IS
 * deterministic for our builder, but `toEqual` doesn't deep-compare
 * Map contents the same way as objects.
 */
function withoutByIdMap<T extends { byId: unknown }>(m: T): Omit<T, 'byId'> {
  const out = { ...m };
  delete (out as { byId?: unknown }).byId;
  return out;
}

describe('determinism', () => {
  it('produces identical output for two runs over the same input', () => {
    const m1 = buildDomIdMap(simpleHomeDesign());
    const m2 = buildDomIdMap(simpleHomeDesign());
    expect(withoutByIdMap(m1)).toEqual(withoutByIdMap(m2));
    // byId contents also equal — same set of keys, equal entries.
    expect([...m1.byId.keys()].sort()).toEqual([...m2.byId.keys()].sort());
  });

  it('produces the same DOM-ID sequence across 10 runs', () => {
    const sequences: string[][] = [];
    for (let i = 0; i < 10; i++) {
      const m = buildDomIdMap(simpleHomeDesign());
      sequences.push(m.entries.map((e) => e.domId));
    }
    const first = sequences[0]!;
    for (const s of sequences.slice(1)) {
      expect(s).toEqual(first);
    }
  });

  it('does not depend on input route ordering', () => {
    // Same trees, routes reversed.
    const a = simpleHomeDesign();
    const b = simpleHomeDesign();
    b.routes = [...b.routes].reverse();
    const ma = buildDomIdMap(a);
    const mb = buildDomIdMap(b);
    expect(ma.entries.map((e) => e.domId)).toEqual(mb.entries.map((e) => e.domId));
  });

  it('does not depend on input sharedComponents ordering', () => {
    const a = simpleHomeDesign();
    const b = simpleHomeDesign();
    a.sharedComponents = [
      { id: 'monogram', node: { tag: 'svg', role: 'shared-ref', domId: 'shared-monogram' } },
      { id: 'badge', node: { tag: 'span', role: 'shared-ref', domId: 'shared-badge' } },
    ];
    b.sharedComponents = [
      { id: 'badge', node: { tag: 'span', role: 'shared-ref', domId: 'shared-badge' } },
      { id: 'monogram', node: { tag: 'svg', role: 'shared-ref', domId: 'shared-monogram' } },
    ];
    const ma = buildDomIdMap(a);
    const mb = buildDomIdMap(b);
    expect(ma.entries.map((e) => e.domId)).toEqual(mb.entries.map((e) => e.domId));
  });
});

describe('stable-ID survival across re-uploads', () => {
  it('survives an attribute change with the same IDs', () => {
    const v1 = buildDomIdMap(simpleHomeDesign());
    const v2 = buildDomIdMap(modifyHomeForV2({ attrs: true }));
    expect([...v1.byId.keys()].sort()).toEqual([...v2.byId.keys()].sort());
  });

  it('survives a copy change with the same IDs', () => {
    const v1 = buildDomIdMap(simpleHomeDesign());
    const v2 = buildDomIdMap(modifyHomeForV2({ copy: true }));
    expect([...v1.byId.keys()].sort()).toEqual([...v2.byId.keys()].sort());
  });

  it('survives an asset swap with the same IDs', () => {
    const v1 = buildDomIdMap(simpleHomeDesign());
    const v2 = buildDomIdMap(modifyHomeForV2({ asset: true }));
    expect([...v1.byId.keys()].sort()).toEqual([...v2.byId.keys()].sort());
  });

  it('survives a token-only style change with the same IDs', () => {
    const v1 = buildDomIdMap(simpleHomeDesign());
    const v2 = buildDomIdMap(modifyHomeForV2({ token: true }));
    expect([...v1.byId.keys()].sort()).toEqual([...v2.byId.keys()].sort());
  });

  it('assigns a new ID when a new element is added under an existing parent', () => {
    const v1 = buildDomIdMap(simpleHomeDesign());
    const v2 = buildDomIdMap(modifyHomeForV2({ addNew: true }));
    const v1Ids = new Set(v1.byId.keys());
    const v2Ids = new Set(v2.byId.keys());
    expect(v2Ids.has('WD-home-hero-badge')).toBe(true);
    expect(v1Ids.has('WD-home-hero-badge')).toBe(false);
    // Everything in v1 still present in v2.
    for (const id of v1Ids) expect(v2Ids.has(id)).toBe(true);
  });

  it('removes the dropped ID and keeps every survivor when an element is deleted', () => {
    const v1 = buildDomIdMap(simpleHomeDesign());
    const v2 = buildDomIdMap(modifyHomeForV2({ removeOne: true }));
    const v1Ids = new Set(v1.byId.keys());
    const v2Ids = new Set(v2.byId.keys());
    expect(v1Ids.has('WD-home-footer-copyright')).toBe(true);
    expect(v2Ids.has('WD-home-footer-copyright')).toBe(false);
    // Footer itself survives.
    expect(v2Ids.has('SE-home-footer')).toBe(true);
  });

  it('keeps adapter-supplied IDs through a sibling reorder (position is recorded separately)', () => {
    // The adapter-supplied IDs survive the reorder; the `position`
    // value shifts. This is the structural signal the diff layer
    // turns into `position_changed`.
    const v1 = buildDomIdMap(simpleHomeDesign());
    const v2 = buildDomIdMap(modifyHomeForV2({ positionShift: true }));
    const ctaV1 = v1.byId.get('WD-home-hero-cta');
    const ctaV2 = v2.byId.get('WD-home-hero-cta');
    expect(ctaV1?.position).toBe(0);
    expect(ctaV2?.position).toBe(1);
    expect(v2.byId.has('WD-home-hero-cta')).toBe(true);
    expect(v2.byId.has('WD-home-hero-headline')).toBe(true);
  });

  it('changes the derived ID when a derived-ID element is reparented', () => {
    // Two designs differ only in the position of a tag-derived (no
    // adapter id) leaf — the derived ID should change because the
    // fingerprint includes parent path + position.
    const v1 = buildDomIdMap({
      designVersionId: 'dv_a',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'main',
            role: 'page',
            children: [
              { tag: 'h1', role: 'leaf' },
              { tag: 'p', role: 'leaf' },
            ],
          },
        },
      },
    });
    const v2 = buildDomIdMap({
      designVersionId: 'dv_b',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'main',
            role: 'page',
            children: [
              { tag: 'p', role: 'leaf' }, // reordered
              { tag: 'h1', role: 'leaf' },
            ],
          },
        },
      },
    });
    expect([...v1.byId.keys()].sort()).not.toEqual([...v2.byId.keys()].sort());
  });
});
