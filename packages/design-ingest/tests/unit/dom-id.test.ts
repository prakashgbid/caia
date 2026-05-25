import { describe, expect, it } from 'vitest';
import {
  assignStableDomIds,
  buildDomIdMap,
  composeDomId,
  finalizeDomIds,
  buildSegment,
  slugifyTag,
} from '../../src/dom-id.js';
import { minimalDesign } from '../helpers/fixtures.js';

describe('DOM-ID helpers', () => {
  it('re-exports atlas-mapper composeDomId', () => {
    expect(composeDomId('page-home', 'section-hero')).toBe('page-home>section-hero');
  });

  it('re-exports slugifyTag', () => {
    expect(typeof slugifyTag('HomeHeroSlider')).toBe('string');
  });

  it('finalizeDomIds returns a finalised design', () => {
    const d = minimalDesign();
    const finalised = finalizeDomIds(d);
    expect(finalised).toBeDefined();
    expect(finalised.routes).toHaveLength(1);
  });

  it('finalizeDomIds preserves adapter-supplied IDs', () => {
    const d = minimalDesign();
    const finalised = finalizeDomIds(d);
    expect(finalised.componentTrees['tree:home']?.node.domId).toBe('page-home');
  });

  it('assignStableDomIds returns a fresh object (deep-clone)', () => {
    const d = minimalDesign();
    const finalised = assignStableDomIds(d);
    expect(finalised).not.toBe(d);
  });

  it('buildDomIdMap covers all nodes', () => {
    const d = minimalDesign();
    const finalised = finalizeDomIds(d);
    const map = buildDomIdMap(finalised);
    expect(map.entries.length).toBeGreaterThan(0);
    expect(map.byId.size).toBeGreaterThan(0);
  });

  it('buildSegment kebab-cases and joins level + slug', () => {
    expect(buildSegment('section', 'HeroBand')).toBe('section-hero-band');
  });

  it('buildSegment with index suffixes', () => {
    expect(buildSegment('widget', 'Monogram', 3)).toBe('widget-monogram-3');
  });
});
