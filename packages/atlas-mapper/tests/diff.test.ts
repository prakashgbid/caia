import { describe, it, expect } from 'vitest';
import { diffDesigns, diffMaps, buildDomIdMap } from '../src/index.js';
import {
  simpleHomeDesign,
  modifyHomeForV2,
} from './fixtures.js';

describe('diffDesigns — unchanged designs', () => {
  it('reports zero added/removed/modified when both designs are identical', () => {
    const v1 = simpleHomeDesign();
    const v2 = simpleHomeDesign({ designVersionId: 'dv_simple_home_v2' });
    const d = diffDesigns(v1, v2);
    expect(d.summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 8 });
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.modified).toEqual([]);
  });

  it('carries the version ids through the diff envelope', () => {
    const d = diffDesigns(
      simpleHomeDesign({ designVersionId: 'A' }),
      simpleHomeDesign({ designVersionId: 'B' }),
    );
    expect(d.fromDesignVersionId).toBe('A');
    expect(d.toDesignVersionId).toBe('B');
  });
});

describe('diffDesigns — single-reason modifications', () => {
  it('detects attrs_changed when attrs differ', () => {
    const d = diffDesigns(simpleHomeDesign(), modifyHomeForV2({ attrs: true }));
    expect(d.modified).toHaveLength(1);
    expect(d.modified[0]?.domId).toBe('WD-home-hero-cta');
    expect(d.modified[0]?.reasons).toEqual(['attrs_changed']);
  });

  it('detects copy_changed when referenced copy text changes', () => {
    const d = diffDesigns(simpleHomeDesign(), modifyHomeForV2({ copy: true }));
    expect(d.modified).toHaveLength(1);
    expect(d.modified[0]?.domId).toBe('WD-home-hero-headline');
    expect(d.modified[0]?.reasons).toEqual(['copy_changed']);
  });

  it('detects asset_changed when an asset content-hash changes', () => {
    const d = diffDesigns(simpleHomeDesign(), modifyHomeForV2({ asset: true }));
    expect(d.modified).toHaveLength(1);
    expect(d.modified[0]?.domId).toBe('WD-home-hero-image');
    expect(d.modified[0]?.reasons).toEqual(['asset_changed']);
  });

  it('detects token_changed when resolvedStyle differs but attrs do not', () => {
    const d = diffDesigns(simpleHomeDesign(), modifyHomeForV2({ token: true }));
    expect(d.modified).toHaveLength(1);
    expect(d.modified[0]?.domId).toBe('WD-home-hero-headline');
    expect(d.modified[0]?.reasons).toEqual(['token_changed']);
  });

  it('detects position_changed on a sibling reorder of adapter-supplied IDs', () => {
    const d = diffDesigns(simpleHomeDesign(), modifyHomeForV2({ positionShift: true }));
    // Both the CTA and the headline moved.
    const positionDiffs = d.modified.filter((m) =>
      m.reasons.includes('position_changed'),
    );
    expect(positionDiffs.map((m) => m.domId).sort()).toEqual([
      'WD-home-hero-cta',
      'WD-home-hero-headline',
    ]);
  });
});

describe('diffDesigns — add / remove', () => {
  it('reports an addition when a new DOM-ID appears in v2', () => {
    const d = diffDesigns(simpleHomeDesign(), modifyHomeForV2({ addNew: true }));
    expect(d.added.map((e) => e.domId)).toEqual(['WD-home-hero-badge']);
    expect(d.removed).toEqual([]);
    expect(d.summary.added).toBe(1);
  });

  it('reports a removal when a DOM-ID disappears in v2', () => {
    const d = diffDesigns(simpleHomeDesign(), modifyHomeForV2({ removeOne: true }));
    expect(d.removed.map((e) => e.domId)).toEqual(['WD-home-footer-copyright']);
    expect(d.added).toEqual([]);
    expect(d.summary.removed).toBe(1);
  });

  it('handles add + remove + modify together', () => {
    const d = diffDesigns(
      simpleHomeDesign(),
      modifyHomeForV2({ addNew: true, removeOne: true, attrs: true }),
    );
    expect(d.added.map((e) => e.domId)).toEqual(['WD-home-hero-badge']);
    expect(d.removed.map((e) => e.domId)).toEqual(['WD-home-footer-copyright']);
    expect(d.modified.map((m) => m.domId)).toContain('WD-home-hero-cta');
  });
});

describe('diffDesigns — multi-reason modifications', () => {
  it('reports multiple reasons in canonical order on a node hit by several changes', () => {
    // Make BOTH the headline's resolvedStyle (token) AND attrs change so
    // the node should report attrs_changed only (token suppressed when
    // attrs changed) — and ALSO change its copy ref. We expect
    // ['attrs_changed', 'copy_changed'] in that order.
    const v1 = simpleHomeDesign();
    const v2 = modifyHomeForV2({ copy: true });
    // Add an attrs change on the same headline.
    const headline =
      v2.componentTrees['tree:home']!.node.children![0]!.children![0]!.children![1]!;
    headline.attrs = { ...(headline.attrs ?? {}), className: 'pt-hero-headline-v2' };

    const d = diffDesigns(v1, v2);
    const headlineMod = d.modified.find((m) => m.domId === 'WD-home-hero-headline');
    expect(headlineMod?.reasons).toEqual(['attrs_changed', 'copy_changed']);
  });

  it('does not report token_changed when attrs already changed (deduplicated)', () => {
    // attrs change on the headline, which would also incidentally
    // affect the token path. We only want attrs_changed.
    const v1 = simpleHomeDesign();
    const v2 = simpleHomeDesign({ designVersionId: 'dv_simple_home_v2' });
    const headline =
      v2.componentTrees['tree:home']!.node.children![0]!.children![0]!.children![1]!;
    headline.attrs = { ...(headline.attrs ?? {}), className: 'tweaked' };
    headline.resolvedStyle = { fontFamily: 'Inter', color: '#1e2a35' };
    const d = diffDesigns(v1, v2);
    const m = d.modified.find((x) => x.domId === 'WD-home-hero-headline');
    expect(m?.reasons).toContain('attrs_changed');
    expect(m?.reasons).not.toContain('token_changed');
  });
});

describe('diffDesigns — determinism', () => {
  it('produces equal output on repeated runs', () => {
    const v1 = simpleHomeDesign();
    const v2 = modifyHomeForV2({ attrs: true, copy: true, asset: true, addNew: true });
    const a = diffDesigns(v1, v2);
    const b = diffDesigns(v1, v2);
    expect(a).toEqual(b);
  });

  it('sorts added / removed / modified lexicographically', () => {
    const v1 = simpleHomeDesign();
    const v2 = simpleHomeDesign({ designVersionId: 'v2' });

    // Inject two additions to verify ordering. We add a sibling with
    // adapter-supplied IDs so we can control the names exactly.
    const tree = v2.componentTrees['tree:home']!.node;
    tree.children!.push({ tag: 'aside', role: 'section', domId: 'SE-z-sidebar' });
    tree.children!.push({ tag: 'aside', role: 'section', domId: 'SE-a-aside' });

    const d = diffDesigns(v1, v2);
    expect(d.added.map((e) => e.domId)).toEqual(['SE-a-aside', 'SE-z-sidebar']);
  });
});

describe('diffMaps — lower-level entry', () => {
  it('returns the same result as diffDesigns when given precomputed maps', () => {
    const v1 = simpleHomeDesign();
    const v2 = modifyHomeForV2({ attrs: true, copy: true });
    const a = diffDesigns(v1, v2);
    const m1 = buildDomIdMap(v1);
    const m2 = buildDomIdMap(v2);
    const b = diffMaps(m1, m2, v1, v2);
    expect(a).toEqual(b);
  });
});

describe('diffDesigns — copy / asset edge cases', () => {
  it('detects copy_changed when the set of copyRefs gains an entry', () => {
    const v1 = simpleHomeDesign();
    const v2 = simpleHomeDesign({ designVersionId: 'v2' });
    const cta = v2.componentTrees['tree:home']!.node.children![0]!.children![0]!.children![0]!;
    cta.copyRefs = [...(cta.copyRefs ?? []), 'copy:cta-aria'];
    v2.copy!.push({ domId: 'copy:cta-aria', text: 'Get in touch', locale: 'en-US' });
    const d = diffDesigns(v1, v2);
    const ctaMod = d.modified.find((m) => m.domId === 'WD-home-hero-cta');
    expect(ctaMod?.reasons).toContain('copy_changed');
  });

  it('detects asset_changed when the assetRefs set differs', () => {
    const v1 = simpleHomeDesign();
    const v2 = simpleHomeDesign({ designVersionId: 'v2' });
    const image = v2.componentTrees['tree:home']!.node.children![0]!.children![1]!;
    image.assetRefs = []; // removed
    const d = diffDesigns(v1, v2);
    const imgMod = d.modified.find((m) => m.domId === 'WD-home-hero-image');
    expect(imgMod?.reasons).toContain('asset_changed');
  });

  it('does not report copy_changed when copy refs and text are identical', () => {
    const v1 = simpleHomeDesign();
    // Same design, just bump designVersionId — copy is identical.
    const v2 = simpleHomeDesign({ designVersionId: 'v2' });
    const d = diffDesigns(v1, v2);
    for (const m of d.modified) {
      expect(m.reasons).not.toContain('copy_changed');
    }
  });
});
