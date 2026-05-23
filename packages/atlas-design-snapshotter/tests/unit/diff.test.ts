import { describe, expect, it } from 'vitest';
import {
  diffDesigns,
  emptyDiff,
  summarizeDiff,
} from '../../src/diff.js';
import {
  assetHashChangedDesign,
  assetRemovedDesign,
  baseDesign,
  copyChangedDesign,
  interactivityAddedDesign,
  nodeAddedDesign,
  nodeMovedDesign,
  propsChangedDesign,
  tokenChangedDesign,
} from '../helpers/fixtures.js';

describe('diffDesigns', () => {
  it('returns an all-empty diff for identical designs', () => {
    const a = baseDesign();
    const b = baseDesign();
    const d = diffDesigns(a, b);
    expect(d).toEqual(emptyDiff());
  });

  it('detects copy text change', () => {
    const d = diffDesigns(baseDesign(), copyChangedDesign());
    expect(d.copy.textChanged).toHaveLength(1);
    expect(d.copy.textChanged[0]!).toMatchObject({
      domId: 'page-home>section-hero>widget-headline>copy-0',
      before: 'Building CAIA',
      after: 'Building CAIA (now with vibes)',
    });
  });

  it('detects node added (and the new copy entry too)', () => {
    const d = diffDesigns(baseDesign(), nodeAddedDesign());
    expect(d.nodes.added).toEqual(
      expect.arrayContaining([
        'page-home>section-stats',
        'page-home>section-stats>widget-counter',
      ]),
    );
    expect(d.copy.added).toContain('page-home>section-stats>widget-counter>copy-0');
  });

  it('detects node moved (stable DOM-ID under new parent)', () => {
    const d = diffDesigns(baseDesign(), nodeMovedDesign());
    expect(d.nodes.added).toContain('page-home>section-footer-cta');
    const moved = d.nodes.moved.find(
      (m) => m.domId === 'page-home>section-hero>widget-cta-button',
    );
    expect(moved).toBeDefined();
    expect(moved!.fromParent).toEqual('page-home>section-hero');
    expect(moved!.toParent).toEqual('page-home>section-footer-cta');
    // The CTA button is NOT in `removed` — DOM-ID stability prevented it.
    expect(d.nodes.removed).not.toContain('page-home>section-hero>widget-cta-button');
  });

  it('detects token value changed', () => {
    const d = diffDesigns(baseDesign(), tokenChangedDesign());
    expect(d.tokens.valueChanged).toHaveLength(1);
    expect(d.tokens.valueChanged[0]!).toMatchObject({
      bucket: 'colors',
      key: '--accent',
      before: '#3d6c95',
      after: '#2a5680',
    });
  });

  it('detects asset hash changed', () => {
    const d = diffDesigns(baseDesign(), assetHashChangedDesign());
    expect(d.assets.hashChanged).toHaveLength(1);
    expect(d.assets.hashChanged[0]!.path).toBe('/headshot.jpg');
  });

  it('detects asset removed', () => {
    const d = diffDesigns(baseDesign(), assetRemovedDesign());
    expect(d.assets.removed).toEqual(['/headshot.jpg']);
  });

  it('detects props changed (className)', () => {
    const d = diffDesigns(baseDesign(), propsChangedDesign());
    const change = d.nodes.propsChanged.find((p) => p.domId === 'page-home>section-hero');
    expect(change).toBeDefined();
    expect((change!.before as { attrs: { className: string } }).attrs.className).toBe(
      'pt-band-cool',
    );
    expect((change!.after as { attrs: { className: string } }).attrs.className).toBe(
      'pt-band-warm',
    );
  });

  it('detects interactivity added', () => {
    const d = diffDesigns(baseDesign(), interactivityAddedDesign());
    expect(d.interactivity.added).toContain('page-home>section-hero>widget-headline');
  });

  it('output ordering is deterministic across permuted inputs', () => {
    // Two equivalent diffs produced from differently-ordered input arrays
    // should serialise to the same JSON.
    const next1 = nodeAddedDesign();
    const next2 = nodeAddedDesign();
    // Reverse copy[] order in one — diff output must still sort.
    next2.copy = [...next2.copy!].reverse();
    const d1 = diffDesigns(baseDesign(), next1);
    const d2 = diffDesigns(baseDesign(), next2);
    expect(JSON.stringify(d1)).toEqual(JSON.stringify(d2));
  });
});

describe('summarizeDiff', () => {
  it('zero changes for empty diff', () => {
    const s = summarizeDiff(emptyDiff());
    expect(s.totalChanges).toBe(0);
  });

  it('rolls up tree + copy changes', () => {
    const d = diffDesigns(baseDesign(), nodeAddedDesign());
    const s = summarizeDiff(d);
    expect(s.nodesAdded).toBeGreaterThanOrEqual(2);
    expect(s.copyChanged).toBeGreaterThanOrEqual(1);
    expect(s.totalChanges).toBe(
      s.nodesAdded +
        s.nodesRemoved +
        s.nodesMoved +
        s.nodesPropsChanged +
        s.tokensChanged +
        s.copyChanged +
        s.assetsChanged +
        s.interactivityChanged,
    );
  });
});
